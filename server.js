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
// app.get('/movies', getMovies);
// app.get('/yelp', getYelp);


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


// function searchToLatLong(request, response) {
//   const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;

//   return superagent.get(url)
//     .then(result => {
//       response.send(new Location(request.query.data, result.body.results[0]));
//     })
//     .catch(error => handleError(error, response));
// }


function getDataFromDB(sqlInfo){
  // create the SQL statement
  let condition = '';
  let values = [];

  if (sqlInfo.searchQuery){
    condition = 'search_query';
    values = [sqlInfo.searchQuery];

  }else{
    condition = 'location_id';
    values = [sqlInfo.id];
  }

  let sql = `SELECT * FROM ${sqlInfo.endpoint}s WHERE ${condition}=$1;`;

  // get the data and return it
  try{return client.query(sql, values);}
  catch (err) {handleError(err);}
}


function saveDataToDB(sqlInfo){
  // create the parameter placeholder
  let params = [];

  for (let i = 1; i<= sqlInfo.values.length; i++){
    params.push(`$${i}`);
  }

  let sqlParams = params.join();

  let sql = '';

  if (sqlInfo.searchQuery){
    // for location only
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams}) RETURNING ID;`;
  }else{
    // for all other endpoints
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams});`;
  }

  // save the data
  try{return client.query(sql, sqlInfo.values);}
  catch (err){handleError(err);}

}


function checkTimeOuts(sqlInfo, sqlData){

  const timeouts = {
    weather: 15*1000,
    yelp: 24*100*60*60,
    movie:30*1000*60*60*24,
    event:6*1000*60*60,
    trail:7*1000*60*60*24,

  };

  // if data exists, check the age
  if(sqlData.rowCount>0){
    let ageOfResults = (Date.now() - sqlData.rows[0].created_at);

    // debugging
    console.log(sqlInfo.endpoint, ' age is ', ageOfResults);
    console.log(sqlInfo.endpoint, ' timeout is ', timeouts[sqlInfo.endpoint]);

    // compare the age of the result with the timeout value
    // if data is old: DELETE!!!!!
    if(ageOfResults>timeouts[sqlInfo.endpoint]){
      let sql = `DELETE FROM ${sqlInfo.endpoint}s WHERE location_id=$1;`;
      let values = [sqlInfo.id];

      client.query(sql, values)
      .then(()=>{return null;})
      .catch(err=>handleError(err));

    }else{return sqlData;}
    
  }
  return null;
}


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
        console.log('this is not from DB');
        // otherwise go get the data from the API
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;

        superagent.get(url)
          .then(result => {
            if (!result.body.results.length) { throw 'NO DATA'; }
            else {
              let location = new Location(sqlInfo.searchQuery, result.body.results[0]);

              sqlInfo.columns = Object.keys(location).join();
              sqlInfo.values = Object.values(location);

              saveDataToDB(sqlInfo)
                .then(data => {
                  // attach the returning id to the location object
                  location.id = data.rows[0].id;
                  response.send(location);
                });
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}
function Location(query, location) {
  this.search_query = query;
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}



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
        console.log('this came from DB');
      } else {
        const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

        return superagent.get(url)
          .then(weatherResults => {
            console.log('Weather from API');
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

function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
  this.created_at = Date.now();
}

// We can keep these for comparisson
// function getEvents(request, response) {
//   const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;

//   superagent.get(url)
//     .then(result => {
//       const events = result.body.events.map(eventData => {
//         const event = new Event(eventData);
//         return event;
//       });

//       response.send(events);
//     })
//     .catch(error => handleError(error, response));
// // }

function getEvents(request, response) {
  let query = request.query.data.id;
  let sql = `SELECT * FROM events WHERE location_id=$1;`;
  let values = [query];

  client.query(sql, values)
    .then(result => {
      if(result.rowCount > 0) {
        console.log('Event from SQL');
        response.send(result.rows);
      } else {
        const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;

        return superagent.get(url)
          .then(result => {
            console.log('Event from API');
            if (!result.body.events.length) {throw 'NO DATA';}
            else {
              const eventSummaries = result.body.events.map(eventData => {
                let event = new Event(eventData);
                event.id = query;

                let newSQL = `INSERT INTO events (link, name, event_date, summary, location_id) VALUES ($1, $2, $3, $4, $5);`;
                let newValues = Object.values(event);

                client.query(newSQL, newValues);

                return event;
              });
              response.send(eventSummaries);
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}
function Event(event) {
  this.link = event.url;
  this.name = event.name.text;
  this.event_date = new Date(event.start.local).toString().slice(0, 15);
  this.summary = event.summary;
}
