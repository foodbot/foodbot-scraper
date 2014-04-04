var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var _ = require('underscore');
var pmongo = require('promised-mongo');
var db = pmongo('mongodb://feedmeserver.cloudapp.net:27017/feedme', ["meetup"]); // feedmeserver.cloudapp.net/feedme

var meetupApiKey = process.env.MEETUPAPIKEY || "123FAKEKEY";
var radius = "30"; //in miles
var lat = "30"; //lat and lon for SF
var lon = "40";


// request.getAsync({url:"https://api.meetup.com/2/open_events.json", qs:{key:meetupApiKey, lat:lat, lon:lon, radius:radius, limited_events:"false", text_format:"plain", time:(new Date().getTime())+","}})
// .then(function(response){
//   var body = JSON.parse(response[0].body);
//   var results = body.results;
//   console.log(response);
//   console.log(results);
// });
var newEvent = {
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

db.meetup.insert(newEvent)
.then(function(item){
  console.log("inserted", newEvent);
})
.catch(function(err){
  console.log("crash", err);
  process.exit(1);
});




