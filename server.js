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
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&query=${request.query.data.search_query}&page=1&include_adult=false
        `;
  
        superagent.get(url)
          .then(movieResult => {
            // console.log('MOVIE from API🎦', movieResult.body, '🎦');
            if (!movieResult.body.results.length) { throw 'NO DATA'; }
            else {
              const movieSummaries = movieResult.body.results.map(movieData => {
                let movie = new Movie(movieData);
                movie.location_id=sqlInfo.id;

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
  console.log('made it to yelps');
  let sqlInfo = {
    id: request.query.id,
    endpoint: 'yelp',
  }
  getDataFromDB(sqlInfo)
  .then(data => checkTimeOuts(sqlInfo, data))
    .then(result => {
      if (result) {
        console.log('YELPING from SQL');
        response.send(result.rows);
      } else {
        const url = `https://api.yelp.com/v3/businesses/search?latitude=${request.query.data.latitude}&longitude=${request.query.data.longitude}`;

        superagent.get(url).set('Authorization', `Bearer ${process.env.YELP_API_KEY}`).then(yelpResult => {

            console.log('YELP from API of YELP 🔴', yelpResult.body.businesses, '🔴');

            if (!yelpResult.body.businesses.length) { throw 'NO DATA'; }
            else {
              let yelpSummaries = yelpResult.body.businesses.map(yelpData => {
                let yelp = new Yelp(yelpData);
                yelp.location_id = sqlInfo.id;

                sqlInfo.columns = Object.keys(yelp).join();
                sqlInfo.values = Object.values(yelp);

                saveDataToDB(sqlInfo);
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
  this.time = new Date(day.time * 1000).toDateString();
  this.created_at = Date.now();
}

// CONSTRUCTOR: Event Data
function Event(event) {
  this.link = event.url;
  this.name = event.name.text;
  this.event_date = new Date(event.start.local).toDateString();
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
  this.image_url = `https://image.tmdb.org/t/p/w370_and_h556_bestv2/${movie.poster_path}`;
  this.popularity = movie.popularity;
  this.released_on = movie.release_date;
}

// CONSTRUCTOR: Trail Data
function Trail(trail){
  this.name = trail.name;
  this.location = trail.location;
  this.length = trail.length;
  this.stars = trail.stars;
  this.star_votes = trail.starVotes;
  this.summary = trail.summary;
  this.trail_url = trail.url;
  this.conditions = trail.conditionStatus;
  this.condition_date = trail.conditionDate.split(' ').slice(0,1).join();
  this.condition_time = trail.conditionDate.split(' ').slice(1,2).join();
}
