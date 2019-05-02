'use strict';

// Load up our variables from .env--the chamber of secrets! .env keeps our keys safe, but we can load them here to make our services work
require('dontenv').config();

// App dependencies--we need these for our app to run
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');
// express is a nodejs library that does our "heavy lifting", cors is a middleman that allows our server to talk to others (cross origin resource sharing), superagent is an ajax library and deals with requests, pg is for postgres our sql database

// App Setup
const app = express();
app.use(cors());
const PORT = process.env.PORT
// here we make sure we are turning things on--we are using express now, and making sure htat uses cors, and we are also declaring our PORT

// Connect to the Database
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err=>console.log(err));
// client is our database and here we are declaring that and connecting to it, as well as setting up an error to throw in case things go wrong

// I think I want to check if server is listening once I set things up but before I try to ask for anything...
app.listen(PORT, ()=> console.log(`city explorer's backend is up and running on ${PORT}, y\'all!`))

// Same with error handling, just in case
function errorHandler(err, resp){
  console.error(err);
  if (resp) resp.status(500).send('Whoopsies! We\'d better fix that!');
}

// API routes
app.get('/location', locationFn);
app.get('/weather', weatherFn);
app.get('/events', eventFn);
// we are telling express to go get these things, giving an endpoint and the helper function. Speaking of which...

//Helper Functions!

function locationFn(req, resp){
  let query = req.query.data;

  // Define the search query
  let sql = `SELECT * FROM locations WHERE search_query=$1;`;
  // ^this is saying we're creating a var named sql that is goint to be a sql command that gets all locations where there is this one search query

  let values = [query];
  console.log('line 50, sql and values', sql, values);

  // make the query of the DB
  client.query(sql, values)
  .then(result=>{
    console.log('result from DB', result.rowCount);
    // did DB return any info?
    if (result.rowCount>0){
      resp.send(result.rows[0]);
    }else{
      // if no rows, no info in db, then get come from API
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;

      superagent.get(url)
      .then(result=>{
        if(!result.body.results.length){throw 'NO DATA';
      }else{
        let location = new Location(query, result.body.results[0]);

        let newSQL = `INSERT INTO locations (search_query, formatted_address, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING ID;`;
        let newValues = Object.values(location);

        client.query(newSQL, newValues)
        .then(data=>{
          location.id = data.rows[0].id;
          resp.send(location);
        });
      }
      })
      .catch(error=>errorHandler(err,resp));
    }
  })
}

// location constructor
function Location(query, location){
  this.search_query = query;
  this.formatted_query = location.formatted_address;
  this.latitude = locationgeometry.location.lat;
  this.longtitude = locaiton.geometry,location.lng;
}

function weatherFn(req, resp){
  let query = req.query.data.id;
  let sql = `SELECT * FROM weathers WHERE location_id=$1;`;
  let values = [query];
  client.query(sql,value)
  .then(result=>{
    if (result.rowCount>0){
      resp.send(result.rows);
    }else{
      const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

      superagent.get(url)
      .then(weatherResults=>{
        if(!weatherResults.body.daily.data.length){throw 'NO DATA'}else{
          const weatherSummaries = weatherResults.body.daily.data.map(day=>{
            let summary = new Weather(day);
            summary.id = query;

            let newSQL = `INSERT INTO weathers (forecast, time, location_id) VALUES($1,$2,$3);`;
            let newValues = Object.values(summary);
            client.query(newSQL,newValules);

            return summary;

          });
          resp.send(weatherSummaries);
        }
      })
      .catch(err=>errorHandler(err,resp));
    }
  });
}

function Weather(day){
  this.forecast = day.summary;
  this.time = new Date(day.time*1000).toDateString();
}

function eventFn(req, resp){
  let query = req.query.data.id;
  let sql = `SELECT * FORM events WHERE location_id=$1;`
}

