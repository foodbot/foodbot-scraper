var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var _ = require('underscore');
var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["facebook"]); // feedmeserver.cloudapp.net

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var facebookApiKey = process.env.FACEBOOKAPIKEY || "123FAKEKEY";
var radius = "40000"; //in meters
var targetAddress = "San Francisco";
var insertCount = 0;
var terminateTimer;
var locationNames = [];
var eventIds = [];
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished,", insertCount, "entries added / updated");
  process.exit(1);
};
//terminates program in 30 sec, if no actions taken
var refreshTerminateTimer = function(){
  if(terminateTimer){
    clearTimeout(terminateTimer);
    terminateTimer = null;
  }
  terminateTimer = setTimeout(terminateProgram, 30*1000);
};
//gets all events at the location and adds id to eventIds
var getEventByLocationName = function(name){
  var url = "https://graph.facebook.com/search?q="+name+"&type=event&access_token="+facebookApiKey;
  return request.getAsync(url)
  .then(function(args){
    var body = JSON.parse(args[0].body);
    eventIds = eventIds.concat(_.pluck(body.data, "id"));
  });
};
//recursive function that pulls down "places" data from facebook, and recursively getting any paginated data
var getPlaces = function(apiURL, recursiveCount, finishCallback){
  var nextUrl;
  if(recursiveCount === undefined){
     recursiveCount = 99999;
  }

  console.log("Trying to get location results from:", apiURL);
  request.getAsync(apiURL)
  .then(function(args){
    var body = JSON.parse(args[0].body);
    var results = body.data;
    body.paging = body.paging || {};
    nextUrl = body.paging.next;

    if(results){
      console.log("Results length:", results.length);
      return results;
    }else{
      throw "Results Undefined Error - "+JSON.stringify(body.error);
    }
  })
  .then(function (results){
    locationNames = locationNames.concat(_.pluck(results, "name"));
    return results;
  })
  .then(function (results){
    console.log("Total location Ids:", locationNames.length);
    if(recursiveCount > 1 && nextUrl){
      getPlaces(nextUrl,recursiveCount-1, finishCallback);
    }else{
      finishCallback(locationNames);
    }
  })
  .catch(function(err){
    console.log("ERR:", err);
  });
};
var getEvents = function(ids){
  var eids = _.map(ids, function(id){
     return "eid = "+id; 
  });
  eids = eids.join(" OR ");

  console.log("EIDS:", eids);
  var url = "https://graph.facebook.com/fql?q=SELECT name,description,attending_count,eid,start_time,end_time,location,venue,ticket_uri FROM event WHERE "+eids+"&access_token="+facebookApiKey;
  
  request.getAsync(url)
  .then(function(args){
    var body = JSON.parse(args[0].body);
    body.data = body.data || {};
    console.log(body);
    console.log("Returned Events:", body.data.length);
  });
};
//splits arrays into smaller arrays based on targetLength, returns an array of arrays
var arraySplit = function(array, targetLength){
  var arrayNum = Math.ceil(array.length/targetLength);
  var superArray = [];
  for(var i = 0; i < arrayNum; i++){
    superArray.push(array.slice(0+targetLength*i, targetLength*(i+1)));
  }
  return superArray;
};

request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:targetAddress}})
.then(function(args){
  var body = JSON.parse(args[0].body);
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
  console.log("Lat:", data.lat, "Long:", data.lon, "Status: OK");
  if(!data){
    return;
  }
  var currentDate = new Date().getTime()-24*60*60*1000; //currentTime minus 1 day;
  var url = "https://graph.facebook.com/search?q=*&type=place&center="+data.lat+","+data.lon+"&distance="+radius+"&access_token="+facebookApiKey;
  
  getPlaces(url, 2, function(places){
    var promises = [];
    _.each(places.slice(0,100), function(place){
      promises.push(getEventByLocationName(place));
    });

    Promise.all(promises)
    .then(function(){
      console.log("eventIds length:",eventIds.length);
      getEvents(eventIds.slice(0,2500));
    })
    .catch(function(err){
      console.log(err);
      terminateProgram();
    });
  });
});

