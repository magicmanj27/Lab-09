'use strict';

// Load Environment Variables from the .env file
require('dotenv').config();

// Application Dependencies
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

// Application Setup
const app = express();
app.use(cors());
const PORT = process.env.PORT;

//MAC: DATABASE_URL=postgres://localhost:5432/city_explorer
//WINDOWS: DATABASE_URL=postgres://<user-name>:<password>/@localhost:5432/city_explorer

//Connect to the Database
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.log(err));

// API Routes
app.get('/location', searchToLatLong);
app.get('/weather', getWeather);
app.get('/events', getEvents);
app.get('/movies', getMovies);
app.get('/yelp', getYelps);


// Make sure the server is listening for requests
app.listen(PORT, () => console.log(`City Explorer Backend is up on ${PORT}`));

// ERROR HANDLER
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}

// Helper Functions

// What we need to do to refactor for SQL Storage
// 1. We need to check the database to see if the location exists
//  a. If it exists => get the location from thre database
//  b. Return the locaiton info to the front-end

// 2. If the location is not in the DB
//  a. Get the location from the API
//  b. Run the data through through the constructor
//  c. Save it to the Database
//  d. Add the newly added location id to the location object
//  e. Return the location to the front-end.

// If we have existing data, this is how we grab it
function getDataFromDB(sqlInfo) {
  // create the SQL statement
  let condition = '';
  let values = [];

  if (sqlInfo.searchQuery) {
    condition = 'search_query';
    values = [sqlInfo.searchQuery];

  } else {
    condition = 'location_id';
    values = [sqlInfo.id];
  }

  let sql = `SELECT * FROM ${sqlInfo.endpoint}s WHERE ${condition}=$1;`;

  // get the data and return it
  try { return client.query(sql, values); }
  catch (err) { handleError(err); }
}

// If we don't have existing data, this is how we will set aside in our DB
function saveDataToDB(sqlInfo) {
  // create the parameter placeholder
  let params = [];

  for (let i = 1; i <= sqlInfo.values.length; i++) {
    params.push(`$${i}`);
  }

  let sqlParams = params.join();

  let sql = '';

  if (sqlInfo.searchQuery) {
    // for location only
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams}) RETURNING ID;`;
  } else {
    // for all other endpoints
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams});`;
  }

  // save the data
  try { return client.query(sql, sqlInfo.values); }
  catch (err) { handleError(err); }

}

// We want our data to be current so we will set timeouts ot refresh it
function checkTimeOuts(sqlInfo, sqlData) {

  const timeouts = {
    weather: 15 * 1000,
    yelp: 24 * 100 * 60 * 60,
    movie: 30 * 1000 * 60 * 60 * 24,
    event: 6 * 1000 * 60 * 60,
    trail: 7 * 1000 * 60 * 60 * 24,

  };

  // if data exists, check the age
  if (sqlData.rowCount > 0) {
    let ageOfResults = (Date.now() - sqlData.rows[0].created_at);

    // debugging
    console.log(sqlInfo.endpoint, ' age is ', ageOfResults);
    console.log(sqlInfo.endpoint, ' timeout is ', timeouts[sqlInfo.endpoint]);

    // compare the age of the result with the timeout value
    // if data is old: DELETE!!!!!
    if (ageOfResults > timeouts[sqlInfo.endpoint]) {
      let sql = `DELETE FROM ${sqlInfo.endpoint}s WHERE location_id=$1;`;
      let values = [sqlInfo.id];

      client.query(sql, values)
        .then(() => { return null; })
        .catch(err => handleError(err));

    } else { return sqlData; }

  }
  return null;
}

// HELPER: GEOGRAPHIC DATA -- Other fns use this data as a baseline search parameter
function searchToLatLong(request, response) {
  let sqlInfo = {
    searchQuery: request.query.data,
    endpoint: 'location'
  };

  getDataFromDB(sqlInfo)
    .then(result => {
      // console.log('result from Database', result.rowCount);
      // Did the DB return any info?
      if (result.rowCount > 0) {
        response.send(result.rows[0]);
        console.log('this location is from the DB😍')
      } else {
        console.log('this is not from DB🤷🏻‍♀️');
        // otherwise go get the data from the API
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;
        console.log(url);

        superagent.get(url)
          .then(result => {
            if (!result.body.results.length) { throw 'NO DATA'; }
            else {
              let location = new Location(sqlInfo.searchQuery, result.body.results[0]);
              console.log(location);

              sqlInfo.columns = Object.keys(location).join();
              sqlInfo.values = Object.values(location);

              saveDataToDB(sqlInfo)
                .then(data => {
                  // attach the returning id to the location object
                  location.id = data.rows[0].id;
                  response.send(location);
                  console.log(location);
                });
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}

// HELPER: WEATHER DATA
function getWeather(request, response) {
  let sqlInfo = {
    id: request.query.data.id,
    endpoint: 'weather'
  };

  getDataFromDB(sqlInfo)
    .then(data => checkTimeOuts(sqlInfo, data))
    .then(result => {
      if (result) {
        response.send(results.rows);
        // console.log('this came from DB');
      } else {
        const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;
        console.log(url);

        return superagent.get(url)
          .then(weatherResults => {
            // console.log('Weather from API');
            if (!weatherResults.body.daily.data.length) { throw 'NO DATA'; }
            else {
              const weatherSummaries = weatherResults.body.daily.data.map(day => {
                let summary = new Weather(day);
                summary.location_id = sqlInfo.id;

                sqlInfo.columns = Object.keys(summary).join();
                sqlInfo.values = Object.values(summary);

                saveDataToDB(sqlInfo);

                return summary;

              });
              response.send(weatherSummaries);
            }

          })
          .catch(error => handleError(error, response));
      }
    });
}

// HELPER: EVENT DATA
function getEvents(request, response) {
  let sqlInfo = {
    id: request.query.id,
    endpoint: 'event',
  }
  getDataFromDB(sqlInfo)
    .then(data => checkTimeOuts(sqlInfo, data))
    .then(result => {
      if (result) {
        console.log('Event from SQL');
        response.send(result.rows);
      } else {
        const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;

        superagent.get(url)
          .then(eventRes => {
            if (!eventRes.body.events.length) { throw 'NO DATA'; }
            else {
              const events = eventRes.body.events.map(eventData => {
                let event = new Event(eventData);
                event.location_id = sqlInfo.id;

                sqlInfo.columns = Object.keys(event).join();
                sqlInfo.values = Object.values(event);

                saveDataToDB(sqlInfo);
                return event;

              });

              response.send(events);
            }
          })
          .catch(err => errorHandler(err, response));
      }
    });
}


// HELPER: MOVIE DATA******
function getMovies(request, response) {
  let sqlInfo = {
    id: request.query.id,
    endpoint: 'movie',
  }
  console.log('we are in the movies fn')
  getDataFromDB(sqlInfo)
    .then(data => checkTimeOuts(sqlInfo, data))
    .then(result => {
      if (result) {
        console.log('MOVIE from SQL');
        response.send(result.rows);
      } else {
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&query=${request.query.data.search_query}&page=1
        `;
        // `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&query=${request.query.data.formatted_query}`;

        superagent.get(url)
          .then(movieResult => {
            console.log('MOVIE from API🎦', movieResult.body, '🎦');
            if (!movieResult.body.results.length) { throw 'NO DATA'; }
            else {
              const movieSummaries = movieResult.body.results.map(movieData => {
                let movie = new Movie(movieData);
                movie.location_id=sqlInfo.id;

                // these need to refactor
                // let newSQL = `INSERT INTO movies (title, overview, average_votes, total_votes, image_url, popularity, released_on, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`;
                // let newValues = Object.values(movie);
                sqlInfo.columns = Object.keys(movie).join();
                sqlInfo.values = Object.values(movie);

                saveDataToDB(sqlInfo);
                return movie;
              });
              response.send(movieSummaries);
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}

// HELPER: YELP DATA
function getYelps(request, response) {
  let query = request.query.data.id;
  let sql = `SELECT * FROM yelps WHERE location_id=$1;`;
  let values = [query];
  // console.log('made it to YELP fn')

  client.query(sql, values)
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Yelping from SQL');
        response.send(result.rows);
      } else {
        const url = `https://api.yelp.com/v3/businesses/search?latitude=${request.query.data.latitude}&longitude=${request.query.data.longitude}`;

        return superagent.get(url)
          .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
          .then(result => {
            // console.log('YELP from API of YELP 🔴', result.body.businesses, '🔴');
            if (!result.body.businesses.length) { throw 'NO DATA'; }
            else {
              const yelpSummaries = result.body.businesses.map(yelpData => {
                let yelp = new Yelp(yelpData);
                yelp.id = query;

                let newSQL = `INSERT INTO yelps (name, image_url, price, rating, url, location_id) VALUES ($1, $2, $3, $4, $5, $6);`;
                let newValues = Object.values(yelp);

                client.query(newSQL, newValues);
                // console.log('🔴', yelp);

                return yelp;
              });
              response.send(yelpSummaries);
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}

//CONSTRUCTOR FUNCTIONS

// CONSTRUCTOR: Geographic Data
function Location(query, location) {
  this.search_query = query;
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}

// CONSTRUCTOR: Weather Data
function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
  this.created_at = Date.now();
}

// CONSTRUCTOR: Event Data
function Event(event) {
  this.link = event.url;
  this.name = event.name.text;
  this.event_date = new Date(event.start.local).toString().slice(0, 15);
  this.summary = event.summary;
}

// CONSTRUCTOR: Yelp Data
function Yelp(yelp) {
  this.name = yelp.name;
  this.image_url = yelp.image_url;
  this.price = yelp.price;
  this.rating = yelp.rating;
  this.url = yelp.url;
}

// CONSTRUCTOR: Movie Data
function Movie(movie) {
  this.title = movie.original_title;
  this.overview = movie.overview;
  this.average_votes = movie.vote_average;
  this.total_votes = movie.vote_count;
  this.image_url = movie.poster_path;
  this.popularity = movie.popularity;
  this.released_on = movie.release_date;
}

// CONSTRUCTOR: Trail Data
// function Trail(trail){
//   this.name = ;
//   this.location = ;
//   this.length = ;
//   this.stars = ;
//   this.star_votes = ;
//   this.summary = ;
//   this.trail_url = ;
//   this.conditions = ;
//   this.condition_date = ;
//   this.condition_time = ;
// }



// 'use strict';

// // Load up our variables from .env--the chamber of secrets! .env keeps our keys safe, but we can load them here to make our services work
// require('dotenv').config();

// // App dependencies--we need these for our app to run
// const express = require('express');
// const cors = require('cors');
// const superagent = require('superagent');
// const pg = require('pg');
// // express is a nodejs library that does our "heavy lifting", cors is a middleman that allows our server to talk to others (cross origin resource sharing), superagent is an ajax library and deals with requestuests, pg is for postgres our sql database

// // App Setup
// const app = express();
// app.use(cors());
// const PORT = process.env.PORT
// // here we make sure we are turning things on--we are using express now, and making sure htat uses cors, and we are also declaring our PORT

// // Connect to the Database
// const client = new pg.Client(process.env.DATABASE_URL);
// client.connect();
// client.on('error', err => console.log(err));
// // client is our database and here we are declaring that and connecting to it, as well as setting up an error to throw in case things go wrong

// // I think I want to check if server is listening once I set things up but before I try to ask for anything...
// app.listen(PORT, () => console.log(`city explorer's backend is up and running on ${PORT}, y\'all!`))

// // Same with error handling, just in case
// function errorHandler(err, response) {
//   console.error(err);
//   if (response) response.status(500).send('Whoopsies! We\'d better fix that!');
// }

// // API routes
// app.get('/location', locationFn);
// app.get('/weather', weatherFn);
// app.get('/events', eventsFn);
// // app.get('/movies', movieFn);
// // app.get('/yelp', yelpFn);
// // app.get('/trails', trailsFn)
// // we are telling express to go get these things, giving an endpoint and the helper function. Speaking of which...

// // HELPER FUNCTIONS
// // these will augment helper fn to be DRY coded
// function getDataFromDB(sqlInfo) {
//   // create the SQL statement based on endpoints and conditions (the only difffernces between the syntax)
//   let condition = '';
//   let values = [];

//   // if we have it we assign conition to query and values to sqlInfo.qry
//   if (sqlInfo.searchQuery) {
//     condition = 'search_query';
//     values = [sqlInfo.searchQuery];
//   } else {
//     // if we dont have it then we will
//     condition = 'location_id';
//     values = [sqlInfo.id];
//   }

//   let sql = `SELECT * FROM ${sqlInfo.endpoint}s WHERE ${condition}=$1;`

//   // Get the data
//   // ---try something, if it doesn't work give you an error
//   // we use try catch becasue we are dealing with a promise and we are attempting it, rather than an if then in which case we would use throw.
//   try { return client.query(sql, values); }
//   catch (err) { errorHandler(err); }
// }

// function saveDataToDB(sqlInfo) {
//   // first create parameters placeholders
//   let params = [];

//   // now we need to get params so check the fn.
//   for (let i = 1; i <= sqlInfo.values.length; i++) {
//     // we are dealing with actual counts not indexes
//     params.push(`$${i}`);
//   }

//   let sqlParams = params.join()

//   let sql = '';

//   if (sqlInfo.searchQuery) {
//     // for location
//     sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams}) RETURNING ID;`
//   } else {
//     // all other endpoints
//     sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams});`
//   }
//   // save the data to our DB

//   try { return client.query(sql, sqlInfo.values); }
//   catch (err) { errorHandler(err); }

// }

// // cache invalidation
// // check data, if 


// // fn to check if data is still valid
// // is there data? if so get its age
// function checkTimeouts(sqlInfo, sqlData) {
//   // establish timelength to keep data
//   // names singular

//   const timeouts = {
//     weather: 15 * 1000, //15 seconds*1000 to get actual seconds insted of milli
//     yelp: 60 * 1000 * 60 * 24, //*minutes*hours to get 1 day
//     movie: 60 * 1000 * 60 * 24 * 30, // 30-Days
//     event: 60 * 1000 * 60 * 6, // 6-Hours
//     trail: 60 * 1000 * 60 * 24 * 7 // 7-Days
//   };

//   if (sqlData.rowCount > 0) {
//     //age of results will be current time/date 

//     // check time at 9:27PM for checking age and deleting if it is old. and if it is not just return it back


//     // we will call this fn in our getdata from DB section of helpers
//     let ageOfResults = (Date.now() - sqlData.rows[0].created_at);

//     // debugging
//     console.log(sqlInfo.endpoint, ' age is ', ageOfResults);
//     console.log(sqlInfo.endpoint, ' timeout is ', timeouts[sqlInfo.endpoint]);

//     // compare the age of the result with the timeout value
//     // if data is old: DELETE!!!!!
//     if (ageOfResults > timeouts[sqlInfo.endpoint]) {
//       let sql = `DELETE FROM ${sqlInfo.endpoint}s WHERE location_id=$1;`;
//       let values = [sqlInfo.id];

//       client.query(sql, values)
//         .then(() => { return null; })
//         .catch(err => handleError(err));

//     } else { return sqlData; }

//   }
//   return null;
// }

// //Helper Functions!

// function locationFn(request, response) {
//   let sqlInfo = {
//     searchQuery: request.query.data,
//     endpoint: 'location'
//   };

//   getDataFromDB(sqlInfo)
//     .then(result => {
//       if (result.rowCount > 0) {
//         response.send(result.rows[0]);
//       } else {
//         const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;

//         superagent.get(url)
//           .then(result => {
//             if (!result.body.results.length) { throw 'NO DATA'; }
//             else {
//               let location = new Location(sqlInfo.searchQuery, result.body.results[0]);

//               sqlInfo.columns = Object.keys(location).join();
//               sqlInfo.values = Object.values(location);

//               saveDataToDB(sqlInfo)
//                 .then(data => {
//                   location.id = data.rows[0].id;
//                   response.send(location);
//                 });
//             }
//           })
//           .catch(error => handleError(error, response));
//       }
//     });
// }


// function weatherFn(request, response) {

//   let sqlInfo = {
//     id: request.query.data.id,
//     endpoint: 'weather'
//   };

//   getDataFromDB(sqlInfo)
//     .then(data => checkTimeouts(sqlInfo, data))
//     .then(result => {
//       if (result) { response.send(result.rows); }
//       else {
//         const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

//         return superagent.get(url)
//           .then(weatherResults => {
//             console.log('Weather from API');
//             if (!weatherResults.body.daily.data.length) { throw 'NO DATA'; }
//             else {
//               const weatherSummaries = weatherResults.body.daily.data.map(day => {
//                 let summary = new Weather(day);
//                 summary.location_id = sqlInfo.id;

//                 sqlInfo.columns = Object.keys(summary).join();
//                 sqlInfo.values = Object.values(summary);

//                 saveDataToDB(sqlInfo);
//                 return summary;
//               });
//               response.send(weatherSummaries);
//             }
//           })
//           .catch(error => handleError(error, response));
//       }
//     });
// }


// function eventsFn(request, response) {
//   let sqlInfo = {
//     id: request.query.id,
//     endpoint: 'event',
//   }
//   getDataFromDB(sqlInfo)
//     .then(data => checkTimeouts(sqlInfo, data))
//     .then(res => {
//       if (res) {
//         console.log('Event from SQL');
//         response.send(res.rows);
//       } else {
//         const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;

//         superagent.get(url)
//           .then(eventRes => {
//             if (!eventRes.body.events.length) { throw 'NO DATA'; }
//             else {
//               const events = eventRes.body.events.map(eventData => {
//                 let event = new Event(eventData);
//                 event.location_id = sqlInfo.id;

//                 sqlInfo.columns = Object.keys(event).join();
//                 sqlInfo.values = Object.values(event);

//                 saveDataToDB(sqlInfo);
//                 return event;

//               });

//               response.send(events);
//             }
//           })
//           .catch(err => errorHandler(err, response));
//       }
//     });
// }


// // CONSTRUCTORS SECTION

// // CONSTRUCTOR: Geographic Data
// function Location(query, location) {
//   this.search_query = query;
//   this.formatted_query = location.formatted_address;
//   this.latitude = location.geometry.location.lat;
//   this.longitude = location.geometry, location.lng;
// }

// // CONSTRUCTOR: Weather Data
// function Weather(day) {
//   this.forecast = day.summary;
//   this.time = new Date(day.time * 1000).toDateString();
//   this.created_at = Date.now();
//   // in schema put after time category , 'created_at VARCHAR(255),'
// }

// // CONSTRUCTOR: Event Data
// function Event(event) {
//   this.link = event.url;
//   this.name = event.name.text;
//   this.event_date = new Date(event.start.local).toString().slice(0, 15);
//   this.summary = event.summary;
// }

// // CONSTRUCTOR: Yelp Data
// function Yelp(yelp) {
//   this.name = yelp.name;
//   this.image_url = yelp.image_url;
//   this.price = yelp.price;
//   this.rating = yelp.rating;
//   this.url = yelp.url;
// }

// // CONSTRUCTOR: Movie Data
// function Movie(movie) {
//   this.title = movie.original_title;
//   this.overview = movie.overview;
//   this.average_votes = movie.vote_average;
//   this.total_votes = movie.vote_count;
//   this.image_url = movie.poster_path;
//   this.popularity = movie.popularity;
//   this.released_on = movie.release_date;
// }

//       // CONSTRUCTOR: Trail Data
// // function Trail(trail){
// //   this.name = ;
// //   this.location = ;
// //   this.length = ;
// //   this.stars = ;
// //   this.star_votes = ;
// //   this.summary = ;
// //   this.trail_url = ;
// //   this.conditions = ;
// //   this.condition_date = ;
// //   this.condition_time = ;
// // }