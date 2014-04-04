var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var _ = require('underscore');
var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["meetup"]); // feedmeserver.cloudapp.net

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var meetupApiKey = process.env.MEETUPAPIKEY || "123FAKEKEY";
var radius = "30"; //in miles
var targetAddress = "San Francisco";
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
    request.getAsync({url:"https://api.meetup.com/2/open_events.json", qs:{key:meetupApiKey, lat:data.lat, lon:data.lon, radius:radius, limited_events:"false", text_format:"plain", time:(new Date().getTime()-24*60*60*1000)+","}})
    .then(function(response){
      var body = JSON.parse(response[0].body);
      var results = body.results;
      console.log("Results length:", results);
      if(results){
        _.map(results, function(item){
          return {
            description:'You Too Can Make Videos That Rock!',
            duration: 10800000,
            fee: 99,
            keywords:'beer, pizza',
            latitude: 37.962147,
            longitude: -122.345528,
            name:'Anns House',
            rsvpCount: 45,
            time: 1396551600000,
            url:'http://www.meetup.com/Raise-Your-Glass-Networking-for-Women-Entrepreneurs/events/169780002/',
            venue: {
              name: 'Women, Wine, Wisdom: Networking for Women Entrepreneurs',
              address: {
                city:'San Francisco',
                country:'US',
                state:'CA',
                address1:'651 Brannan St',
                address2:'#110'
              }
            }
          };
        });


        db.meetup.insert(results)
        .then(function(item){
          console.log("inserted", item);
        })
        .catch(function(err){
          console.log("crash", err);
          process.exit(1);
        });
      }
    });
  });


// db.meetup.insert(newEvent)
// .then(function(item){
//   console.log("inserted", newEvent);
// })
// .catch(function(err){
//   console.log("crash", err);
//   process.exit(1);
// });




