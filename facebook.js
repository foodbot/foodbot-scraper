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
var events = [];
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished,", insertCount, "entries added / updated");
  process.exit(1);
};
//gets all events at the location and adds id to eventIds
var getEventIdsByLocationName = function(name){
  var url = "https://graph.facebook.com/search?q="+name+"&type=event&access_token="+facebookApiKey;
  return request.getAsync(url)
  .spread(function(res, body){
    body = JSON.parse(body);
    if(!body.data){
      throw "getEventIdsByLocationName - "+ JSON.stringify(body);
    }
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
  .spread(function(res, body){
    body = JSON.parse(body);
    var results = body.data;
    body.paging = body.paging || {};
    nextUrl = body.paging.next;

    if(results){
      console.log("Results length:", results.length);
      return results;
    }else{
      throw "getPlaces - "+JSON.stringify(body);
    }
  })
  .then(function (results){
    locationNames = locationNames.concat(_.pluck(results, "name"));
    return results;
  })
  .then(function (results){
    if(recursiveCount > 1 && nextUrl){
      getPlaces(nextUrl,recursiveCount-1, finishCallback);
    }else{
      console.log("Total location Ids:", locationNames.length);
      finishCallback(locationNames);
    }
  })
  .catch(function(err){
    console.log("ERR:", err);
    terminateProgram();
  });
};
var getPlacesAsync = function(apiURL, recursiveCount){
  return new Promise(function(resolve,reject){
    getPlaces(apiURL, recursiveCount, resolve);
  });
};
//takes an array of event id, then builds the giant FQL query url. Can take upto 2000 event id's at a time.
var getEvents = function(ids){
  var eids = _.map(ids, function(id){
     return "eid = "+id; 
  });
  eids = eids.join(" OR ");

  // console.log("EIDS:", eids);
  var url = "https://graph.facebook.com/fql?q=SELECT name,description,attending_count,eid,start_time,end_time,location,venue,ticket_uri FROM event WHERE "+eids+"&access_token="+facebookApiKey;
  
  return request.getAsync(url)
  .spread(function(res, body){
    body = JSON.parse(body);
    if(!body.data){
      throw "getEvents - "+JSON.stringify(body);
    }
    body.data = body.data || [];
    
    events = events.concat(body.data);
    console.log("Received Events:", body.data.length);
    return body.data;
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

//geo-codes the target address and starts the data gathering sequence
request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:targetAddress}})
.spread(function(res, body){
  body = JSON.parse(body);
  if(body.status === "OK"){
    var lat = body.results[0].geometry.location.lat;
    var lon = body.results[0].geometry.location.lng;
    console.log("Lat:", lat, "Long:", lon, "Status: OK");
    return {lat: lat, lon:lon};
  }else {
    throw "API Error: "+body.status;
  }
})
.then(function(data){
  var url = "https://graph.facebook.com/search?q=*&type=place&center="+data.lat+","+data.lon+"&distance="+radius+"&access_token="+facebookApiKey;
  return getPlacesAsync(url, 2);
})
.then(function(places){
  console.log("Getting "+places.length+" EventIdsByLocationName..");
  //delayed to prevent denial of service
  var eventPromises = _.map(places, function(place, index){
    return Promise.delay(100*index).then(function(){
      return getEventIdsByLocationName(place);
    });
  });

  //populates global eventIds array
  return Promise.all(eventPromises);
})
.then(function(){
  var superArray = arraySplit(eventIds, 1000);
  console.log("eventIds length:",eventIds.length);

  //delays to prevent denial of service
  var eventPromises = _.map(superArray, function(eids, index){
    return Promise.delay(100*index).then(function(){
      return getEvents(eids);
    });
  });

  //populates global events array
  return Promise.all(eventPromises);
})
.then(function(){
  console.log("Total Events:", events.length);
  console.log("Trying to load events into DB..");
  var eventPromises = _.map(events, function(item){
    //add to db 
    var fee = null;
    if(item.ticket_uri){
      fee = 99999;
    }
    console.log(item);
    var dbItem = {
      name: item.name,
      description: item.description,
      duration: (new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) || 3*60*60*1000,
      fee: fee,
      rsvpCount: item.attending_count,
      time: new Date(item.start_time).getTime(),
      url: "https://www.facebook.com/events/"+item.eid+"/",
      venue: {
        name: item.location,
        address: {
          city: item.venue.city,
          country: item.venue.country,
          state: item.venue.state,
          address1: item.venue.street +", "+item.venue.city,
          latitude: item.venue.latitude,
          longitude: item.venue.longitude,
        }
      },
      ticketUrl: item.ticket_uri || null,
      unique: item.eid
    };

    return db.facebook.findOne({unique: dbItem.unique})
    .then(function(entry){
      insertCount++;
      if(!entry){
        return db.facebook.insert(dbItem);
      }else{
        return db.facebook.update({unique: dbItem.unique}, dbItem);
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
  terminateProgram();
});
