var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var cheerio = require('cheerio');
var _ = require('underscore');

var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["funcheap"]); 

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var targetUrl = "http://sf.funcheap.com/category/event/event-types/free-food/";
var eventUrls = [];
var pageCount = 0;
var insertCount = 0;
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished,", insertCount, "entries added / updated");
  process.exit(1);
};
//recursively get urls of all event pages from search results
var getEventLinks = function(url, recursiveCount, finishCallback){
  var $;
  pageCount++;
  request.getAsync(url)
  .then(function(args){
    $ = cheerio.load(args[1]);
    return $("span.title a").toArray();
  })
  .map(function(link){
    return $(link).attr('href');
  })
  .then(function(links){
    return _.uniq(links);
  })
  .then(function (links){
    console.log("Links Found:", links.length);
    eventUrls = eventUrls.concat(links);
    var nextPagePath = $("#next.nav").attr('href'); //placeholder
    // console.log("Next Path:", nextPagePath);
    if(recursiveCount > 1 && nextPagePath){
      getEventLinks("http://www.funcheap.com"+nextPagePath, recursiveCount-1, finishCallback);
    }else{
      console.log("Loaded "+pageCount+" pages and "+eventUrls.length+" event urls");
      eventUrls = _.uniq(eventUrls);
      finishCallback(eventUrls);
    }
  });
};
var getEventLinksAsync = function(url, recursiveCount){
  return new Promise(function(resolve, reject){
    getEventLinks(url, recursiveCount, resolve);
  });
};
//scrapes target funcheap event url
var scrapeEventPage = function(url, index){
  return request.getAsync(url)
  .then(function(args){
    console.log("GET["+index+"]:", url);
    var $ = cheerio.load(args[1]);

    var description = 
    $(".entry p").map(function(index, item){
      if(! $(item).is(".head-share-this p")){
        return $(item).text();
      }
    }).toArray().join(" ").trim();

    var venueName = 
    $(".entry").find("div").filter(function(index, item){
      return $(item).text().match(/Venue:/);
    }).text().split(":")[1].trim();

    var address = 
    $(".entry").find("div").filter(function(index, item){
      return $(item).text().match(/Address:/);
    }).text().split(":")[1].trim();

    var price = $("#stats").text().split(" | ")[1].match(/\$\d+/) || ["$0"];
    price = parseFloat(price[0].split("$")[1]);
    
    var duration = 3*60*60*1000;
    var startTime = new Date($("span.left").first().text().split(" | ")[0].split(" to ")[0].replace(" - ", " ") +" PDT").getTime();

    if(!startTime){
      startTime = new Date($("span.left").first().text().split(" | ")[0].split(" - ")[0]).getTime();
      if($("span.left").first().text().split(" | ")[0].split(" - ")[1].toUpperCase() === "ALL DAY"){
        duration = 24*60*60*1000; 
      }
    }
    var item = {
      name: $("h1.title").text().split(" | ")[0],
      description: description,
      duration: duration,
      fee: price,
      rsvpCount: null,
      time: startTime,
      url: url,
      venue: {
        name: venueName,
        address: {
          city: "San Francisco",
          country: "us",
          state: "ca",
          address1: address,
          latitude: null,
          longitude: null,
        }
      },
      unique: url
    };
    return Promise.all([
      request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:address}}),
      item
    ]);
  })
  .spread(function(args, item){
    var body = JSON.parse(args[1]);
    if(body.status === "OK"){
      var lat = body.results[0].geometry.location.lat;
      var lon = body.results[0].geometry.location.lng;
      if(lat && lon){
        item.location = [lon, lat];
      }
      item.venue.address.latitude = lat;
      item.venue.address.longitude = lon;
      return item;
    }else {
      throw "Google API Error: "+body.status;
    }
  })
  .then(function(item){
    return Promise.all([
      db.funcheap.findOne({unique: item.unique}),
      item
    ]);
  })
  .spread(function(entry, item){
    insertCount++;
    if(!entry){
      // console.log("Inserting:", item);
      return db.funcheap.insert(item);
    }else{
      // console.log("Updating:", item);
      return db.funcheap.update({unique: item.unique}, item);
    }
  });
};

getEventLinksAsync(targetUrl, 99999)
.then(function(urls){
  var eventPromises = _.map(urls, function(url, index){
    //Spaced them out so I don't DoS them
    return Promise.delay(250*index)
    .then(function(){
      return scrapeEventPage(url, index);
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


