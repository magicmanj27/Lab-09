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

function searchToLatLong(request, response) {
  let query = request.query.data;

  // Define the search query
  let sql = `SELECT * FROM locations WHERE search_query=$1;`;
  let values = [query];

  console.log('line 71', sql, values);

  // Make the query of the Database
  client.query(sql, values)
    .then(result => {
      console.log('result from Database', result.rowCount);
      // Did the DB return any info?
      if (result.rowCount > 0) {
        response.send(result.rows[0]);
      } else {
        // otherwise go get the data from the API
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;

        superagent.get(url)
          .then(result => {
            if (!result.body.results.length) { throw 'NO DATA'; }
            else {
              let location = new Location(query, result.body.results[0]);

              let newSQL = `INSERT INTO locations (search_query, formatted_address, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING ID;`;
              let newValues = Object.values(location);

              client.query(newSQL, newValues)
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

// pre database entry
// function getWeather(request, response) {
//   const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

//   return superagent.get(url)
//     .then(weatherResults => {
//       const weatherSummaries = weatherResults.body.daily.data.map(day => {
//         return new Weather(day);
//       });
//       response.send(weatherSummaries);
//     })
//     .catch(error => handleError(error, response));
// }

function getWeather(request, response) {
  let query = request.query.data.id;
  let sql = `SELECT * FROM weathers WHERE location_id=$1;`;
  let values = [query];

  client.query(sql, values)
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Weather from SQL');
        response.send(result.rows);
      } else {
        const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

        return superagent.get(url)
          .then(weatherResults => {
            console.log('Weather from API');
            if (!weatherResults.body.daily.data.length) { throw 'NO DATA'; }
            else {
              const weatherSummaries = weatherResults.body.daily.data.map(day => {
                let summary = new Weather(day);
                summary.id = query;

                let newSql = `INSERT INTO weathers (forecast, time, location_id) VALUES($1, $2, $3);`;
                let newValues = Object.values(summary);
                console.log(newValues);
                client.query(newSql, newValues);

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
