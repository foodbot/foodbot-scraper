var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var cheerio = require('cheerio');
var _ = require('underscore');

var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["eventbrite", "junk"]); // feedmeserver.cloudapp.net

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var targetUrl = "http://www.eventbrite.com/directory?loc=San+Francisco%2C+CA&is_miles=True&vp_ne_lat=37.812&slat=37.77&vp_sw_lng=-122.527&slng=-122.42&vp_sw_lat=37.7034&radius=60.0&vp_ne_lng=-122.3482&price=1";
var terminateTimer;
var eventUrls = [];
var pageCount = 0;
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished");
  process.exit(1);
};
//terminates program in 30 sec, if no actions taken
var refreshTerminateTimer = function(){
  if(terminateTimer){
    console.log("resetting timer");
    clearTimeout(terminateTimer);
    terminateTimer = null;
  }
  terminateTimer = setTimeout(terminateProgram, 30*1000);
};
//recursively get urls of all event pages from search results
var getEventLinks = function(url, recursiveCount, finishCallback){
  pageCount++;
  request.getAsync(url)
  .then(function(args){
    var $ = cheerio.load(args[1]);

    var links = $(".js-search-result-click-action").toArray();
    links = _.map(links, function(item){
      var url = $(item).attr('href');
      return url.split("?")[0]; //doesn't return extra query parameters on url
    });
    links = _.uniq(links);
    console.log("Links Found:", links.length);

    eventUrls = eventUrls.concat(links);

    var nextPagePath = $("#next.nav").attr('href');
    console.log("Next Path:", nextPagePath);
    
    if(recursiveCount > 1 && nextPagePath){
      getEventLinks("http://www.eventbrite.com"+nextPagePath, recursiveCount-1, finishCallback);
    }else{
      console.log("Loaded "+pageCount+" pages and "+eventUrls.length+" event urls");
      eventUrls = _.uniq(eventUrls);
      finishCallback(eventUrls);
    }
  });
};
//loads saved urls from db and scrapes them
//urls are saved for better testing
var scrapeSavedUrls = function(){
  db.junk.findOne()
  .then(function(entry){
    _.each(entry.urls, function(item){
      scrapeEventPage(item);
    });
  });
};
//scrapes target eventbrite event url
var scrapeEventPage = function(url){
  request.getAsync(url)
  .then(function(args){
    console.log("GET:", url);
    var $ = cheerio.load(args[1]);
    var address = $("span.adr").text().trim().replace(/(\r\n|\n|\r)/gm,"").replace(/\s+/g, " ") ||
                  $(".l-block-3 li").first().text().trim().replace(/(\r\n|\n|\r)/gm,"").replace(/\s+/g, " ");
    var venueName = $(".fn.org").text().trim() ||
                    $(".l-block-3 h2").first().text().trim();
    var startTime = new Date($("span.dtstart").text().trim().split(" to ")[0].replace(" from", "")).getTime() ||
                    new Date($("span.dtstart").text().trim().split(" - ")[0].replace(" at", "")).getTime() ||
                    new Date($("time").first().text().trim().split(" to ")[0].replace(" from", "")).getTime();
    var endTime;
    var item = {
      name: $("#event_header h1").text(),
      description: $(".panel_section").text(),
      duration: 3*60*60*1000,
      fee: null,
      rsvpCount: parseInt($(".count_subview").text().trim().split(" people")[0]),
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
    request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:address}})
    .then(function(args){
      var body = JSON.parse(args[1]);
      if(body.status === "OK"){
        var lat = body.results[0].geometry.location.lat;
        var lon = body.results[0].geometry.location.lng;
        item.venue.address.latitude = lat;
        item.venue.address.longitude = lon;
        // console.log("Status: OK, lat: ",lat,"lon:",lon);
      }else {
        console.log("API Error:", body.status);
      }
      db.eventbrite.findOne({unique: item.unique})
      .then(function(entry){
        if(!entry){
          console.log("Inserting:", item);
          db.eventbrite.insert(item);
        }else{
          console.log("Updating:", item);
          db.eventbrite.update({unique: item.event_url}, item);
        }
      })
      .catch(function(err){
        console.log("DB error:", err);
      });
    });
    
  });
};

getEventLinks(targetUrl, 2, function(urls){
  db.junk.drop();
  db.junk.insert({urls: urls})
  .then(function(items){
    console.log("Successfully inserted", items.length ,"element(s)");
    scrapeSavedUrls();
  });
});


