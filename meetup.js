var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var _ = require('underscore');
var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["meetup"]); // feedmeserver.cloudapp.net

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var meetupApiKey = process.env.MEETUPAPIKEY || "123FAKEKEY";
var radius = "50"; //in miles
var targetAddress = "San Francisco";
var terminateTimer;
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished");
  process.exit(1);
};
//terminates program in 30 sec, if no actions taken
var refreshTerminateTimer = function(){
  if(terminateTimer){
    console.log("clearing timer");
    clearTimeout(terminateTimer);
    terminateTimer = null;
  }
  terminateTimer = setTimeout(terminateProgram, 30*1000);
};
request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:targetAddress}})
.then(function(response){
  var body = JSON.parse(response[0].body);
  if(body.status === "OK"){
    var lat = body.results[0].geometry.location.lat;
    var lon = body.results[0].geometry.location.lng;
    return {lat: lat, lon:lon};
  }else {
    console.log("API Error:", body.status);
    process.exit(1);
    return null;
  }})
.then(function(data){
  if(!data){
    return;
  }
  console.log("Lat:", data.lat, "Long:", data.lon, "Status: OK");
  var currentDate = new Date().getTime()-24*60*60*1000; //currentTime minus 1 day;
  getResults(data.lat, data.lon, radius, currentDate, 99999);
});
//recursive function that pulls down data from meetup, then changes the start date and recurses again
var getResults = function(lat, lon, radius, startDate, recursiveCount){
  if(recursiveCount === undefined){
     recursiveCount = 99999;
  }
  refreshTerminateTimer();

  var maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear()+1);
  if(startDate > maxDate.getTime()){
    console.log("Max Date Reached:", maxDate);
    return; //ends recursive loop
  }
  console.log("Trying to get results from meetup:", new Date(startDate));
  request.getAsync({url:"https://api.meetup.com/2/open_events.json", qs:{key:meetupApiKey, lat:lat, lon:lon, radius:radius, limited_events:"false", text_format:"plain", time:(startDate+",")}})
  .then(function(response){
    var body = JSON.parse(response[0].body);
    var results = body.results;
    console.log("Results length:", results.length);
    if(results){
      //formats results into normalized database entry 
      results = _.map(results, function(item){
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
      });
      console.log("Results start date:", new Date(results[0].time));
      console.log("Results end date:", new Date(results[results.length-1].time));
      if(recursiveCount >= 1){
        var newStart = results[results.length-1].time - 2*60*60*1000; //searches again using end time, minus 2 hours to ensure we don't miss any
        getResults(lat, lon, radius, newStart,recursiveCount-1);
      }
      _.each(results, function(item){
        db.meetup.findOne({unique: item.unique})
        .then(function(entry){
          if(!entry){
            // console.log("item not found -- inserting");
            db.meetup.insert(item);
          }else{
            // console.log("item already found -- updating");
            db.meetup.save(item);
          }
        })
        .catch(function(err){
          console.log("crash", err);
          process.exit(1);
        });
      });
    }
  });
};


// db.meetup.insert(newEvent)
// .then(function(item){
//   console.log("inserted", newEvent);
// })
// .catch(function(err){
//   console.log("crash", err);
//   process.exit(1);
// });




