var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var _ = require('underscore');
var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["meetup"]);

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var meetupApiKey = process.env.MEETUPAPIKEY || "123FAKEKEY";
var radius = "50"; //in miles
var targetAddress = "San Francisco";
var insertCount = 0;
var events = [];
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished,", insertCount, "entries added / updated");
  process.exit(1);
};
//recursive promise that pulls down data from meetup, then changes the start date and recurses again
var getResults = function(lat, lon, radius, startDate, recursiveCount){
  if(recursiveCount === undefined){
     recursiveCount = 99999;
  }
  console.log("Trying to get results from meetup:", new Date(startDate));
  return request.getAsync({url:"https://api.meetup.com/2/open_events.json", qs:{key:meetupApiKey, lat:lat, lon:lon, radius:radius, limited_events:"false", text_format:"plain", time:startDate+","} })
  .spread(function(res, body){
    var results = JSON.parse(body).results;
    console.log("Results length:", results.length);
    if(results){
     return results;
    }else{
      throw "getResults - "+JSON.stringify(body);
    }
  })
  .then(function (results){
    events = events.concat(results);
    console.log("Results start date:", new Date(results[0].time));
    console.log("Results end date:", new Date(results[results.length-1].time));
    var maxDate = new Date().getTime() + 6*30*24*60*60*1000;
    var newStart = results[results.length-1].time - 2*60*60*1000; //searches again using end time, minus 2 hours to ensure we don't miss any

    if(recursiveCount > 1 && newStart < maxDate){
      return getResults(lat, lon, radius, newStart,recursiveCount-1);
    }
    if(newStart >= maxDate){
      console.log("Max Date Reached:", new Date(maxDate));
    }
    return events;
  });
};

request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:targetAddress}})
.spread(function(res, body){
  body = JSON.parse(body);
  if(body.status === "OK"){
    var lat = body.results[0].geometry.location.lat;
    var lon = body.results[0].geometry.location.lng;
    console.log("Lat:", lat, "Long:", lon, "Status: OK");
    return {lat: lat, lon:lon};
  }else {
    throw "Google API Error -" + body.status;
  }})
.then(function(data){
  var currentDate = new Date().getTime()-24*60*60*1000; //currentTime minus 1 day;
  return getResults(data.lat, data.lon, radius, currentDate, 99999);
})
.map(function(item){
  item.venue = item.venue || {};
  item.fee = item.fee || {};
  return {
    name: item.name,
    description: item.description,
    duration: item.duration,
    fee: item.fee.amount,
    rsvpCount: item.yes_rsvp_count,
    time: item.time,
    url: item.event_url,
    venue: {
      name: item.venue.name,
      address: {
        city: item.venue.city,
        country: item.venue.country,
        state: item.venue.state,
        address1: item.venue.address_1,
        latitude: item.venue.lat,
        longitude: item.venue.lon,
      }
    },
    unique: item.event_url
  };
})
.then(function(results){
  console.log("Inserting events into db..");
  var eventPromises = _.map(results, function(item){
    return db.meetup.findOne({unique: item.unique})
    .then(function(entry){
      insertCount++;
      if(!entry){
        db.meetup.insert(item);
      }else{
        db.meetup.update({unique: item.unique}, item);
      }
    });
  });
  return Promise.all(eventPromises);
})
.then(function(){
  terminateProgram();
})
.catch(function(err){
  console.log("ERR:", err);
});


