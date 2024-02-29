/*
 * Copyright 2019 Ilker Temir <ilker@ilkertemir.com>
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const POLL_INTERVAL = 1      // Poll every N seconds
const API_BASE = 'https://stations.windy.com./pws/update/';
const request = require('request')

const median = arr => {
  const mid = Math.floor(arr.length / 2),
    nums = [...arr].sort((a, b) => a - b);
  return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};

module.exports = function(app) {
  let plugin = {};
  let unsubscribes = [];
  let submitProcess;
  let statusProcess;
  let name = app.getSelfPath('name');

  let API_URI;
  let GPS_Source;
  let CALC_INTERNAL = 0;
  let Wind_Speed_Path = "environment.wind.speedOverGround"; //speedTrue
  let Wind_Direction_Path = "environment.wind.angleTrueGround"; //directionTrue
  
  let lastSuccessfulUpdate;
  let position;
  let windSpeed = [];
  let windGust;
  let windDirectionDD;
  let windDirection;

  /*
  var waterTemperature;
  var temperature;
  var pressure;
  var humidity;
  */

  plugin.id = "signalk-windy";
  plugin.name = "SignalK Windy.com";
  plugin.description = "Windy.com plugin for Signal K";

  plugin.schema = {
    type: 'object',
    required: ['apiKey', 'submitInterval', 'stationId'],
    properties: {
      apiKey: {
        type: 'string',
        title: 'API Key (obtain from stations.windy.com)'
      },
      submitInterval: {
        type: 'number',
        title: 'Submit Interval (minutes)',
        default: 5
      },
      stationId: {
        type: 'number',
        title: 'Windy.com Station ID',
        default: 100 
      },
      provider: {
        type: 'string',
        title: 'Provider',
        default: ''
      },
      url: {
        type: 'string',
        title: 'Web Site',
        default: ''
      },
      GpsSource: {
        type: 'string',
        title: 'Position Source'
      },
      WindSpeedPath: {
        type: 'string',
        title: 'Data key for wind Speed',
        default: 'environment.wind.speedOverGround'
      },
      WindDirectionPath: {
        type: 'string',
        title: 'Data key for wind Direction',
        default: 'environment.wind.angleTrueGround'
      },
      Calc: {
        type: 'number',
        title: 'Calculate internally',
        default: 0
      }
    }
  }

  plugin.start = function(options) {
    if (!options.apiKey) {
      app.error('API Key is required');
      return;
    }

    API_URI = API_BASE + options.apiKey;

    if (options.GpsSource) GPS_Source = options.GpsSource;
    if (options.Calc) CALC_INTERNAL = options.Calc;
    if (options.WindSpeedPath) Wind_Speed_Path = options.WindSpeedPath;
    if (options.WindDirectionPath) Wind_Direction_Path = options.WindDirectionPath;
  
    app.setPluginStatus(`Submitting weather report every ${options.submitInterval} minutes`);

    let subscription = {
      context: 'vessels.self',
      subscribe: [{
        path: 'navigation.position',
        period: POLL_INTERVAL * 1000
      }, {
        path: Wind_Direction_Path,
        period: POLL_INTERVAL * 1000
      }, {
        path: Wind_Speed_Path,
        period: POLL_INTERVAL * 1000
      }, {
        path: 'navigation.headingTrue',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.wind.angleApparent',
        period: POLL_INTERVAL * 1000
      },
    
    
    ]
    };

    app.subscriptionmanager.subscribe(subscription, unsubscribes, function() {
      app.debug('Subscription error');
    }, data => processDelta(data));

    app.debug(`Starting submission process every ${options.submitInterval} minutes`);

    statusProcess = setInterval( function() {
      let statusMessage = '';
      if (lastSuccessfulUpdate) {
        let since = timeSince(lastSuccessfulUpdate);
      	statusMessage += `Successful submission ${since} ago. `;
      }
      if ((windSpeed.length > 0) && (windGust != null)) {
      	let currentWindSpeed = windSpeed[windSpeed.length-1];
      	statusMessage += `Wind speed is ${currentWindSpeed}m/s and max gust is ${windGust}m/s. Directon is ${windDirection} `;
      } 
      app.setPluginStatus(statusMessage);
    }, 10 * 1000);


    /* SUBMIT TO WINDY */
    submitProcess = setInterval( function() {

      /*validate inputs*/
      if ( (position == null) || (windSpeed.length == 0) || (windDirection == null) ) {

	      let message = 'NO SUBMISSION: ';
        if (position == null)
          message += 'No Position data'
        if (windSpeed.length == 0)
          message += 'No Wind speed data.'
        if (windDirection == null)
          message += 'No Wind direction data.'
	      
	      app.debug(message);

        return;
      }

      /* form data packet */
      
      let windspeedMedian = median(windSpeed);
      windspeedMedian = windspeedMedian.toFixed(2);

      let data = {
        stations: [
          { 
            station: options.stationId,
            name: name,
            shareOption: 'Open',
            type: 'Signal K Windy Plugin',
            provider: options.provider,
            url: options.url,
            lat: position.latitude,
            lon: position.longitude,
            elevation: 1 }
        ],
        observations: [
          { 
            station: options.stationId,
            wind: windspeedMedian,
	          gust: windGust,
            winddir: windDirection
          }
        ]
      }
    
      /* removed
      temp: temperature,
      pressure: pressure,
      rh: humidity
      */

      let httpOptions = {
        uri: API_URI,
        method: 'POST',
        json: data
      };

      app.debug(`Submitting data: ${JSON.stringify(data)}`);

      request(httpOptions, function (error, response, body) {
        if (!error || response.statusCode == 200) {
          app.debug('Weather report successfully submitted');

          /* reset data */
	        lastSuccessfulUpdate = Date.now();
          position = null;
          windSpeed = [];
          windGust = null;
          windDirection = null;

          /*
          waterTemperature = null;
          temperature = null;
          pressure = null;
          humidity = null;
          */
        } else {
          app.debug('Error submitting to Windy.com API');
          app.debug(body); 
        }
      }); 
    }, options.submitInterval * 60 * 1000);
  }

  plugin.stop =  function() {
    clearInterval(statusProcess);
    clearInterval(submitProcess);
    app.setPluginStatus('Pluggin stopped');
  };

  function radiantToDegrees(rad) {
    return rad * 57.2958;
  }

  function kelvinToCelsius(deg) {
    return deg - 273.15;
  }

  function processDelta(data) {
    if (!data.updates || !data.updates.length || !data.updates[0].values || !data.updates[0].values.length) {
      return;
    }
    let dict = data.updates[0].values[0];
    let path = dict.path;
    let value = dict.value;
    let source = data.updates[0]['$source'];
    let speed;

    switch (path) {

      case 'navigation.position':
        if ((GPS_Source) && (source != GPS_Source)) break;
        position = value;
        break;

      case Wind_Speed_Path:
        speed = value.toFixed(2);
        speed = parseFloat(speed);
        windSpeed.push(speed);

        /* update max wind gust */
        if ((windGust == null) || (speed > windGust)) windGust = speed;

        if (CALC_INTERNAL == 1)
        {
          windDirection = calculateWindDirection();
          windDirection = radiantToDegrees(windDirection);
          windDirection = Math.round(windDirection);
        }
        
        break;

      case Wind_Direction_Path:
        if (CALC_INTERNAL == 0)
        {
          windDirection = radiantToDegrees(value);
          windDirection = Math.round(windDirection);
        
        }
        break;

      case 'navigation.headingTrue':

        break;

      case 'environment.wind.angleApparent':
        break;



      /*
      case 'environment.water.temperature':
        waterTemperature = kelvinToCelsius(value);
        waterTemperature = waterTemperature.toFixed(1);
        waterTemperature = parseFloat(waterTemperature);
        break;

      case 'environment.outside.temperature':
        temperature = kelvinToCelsius(value);
        temperature = temperature.toFixed(1);
        temperature = parseFloat(temperature);
        break;

      case 'environment.outside.pressure':
        pressure = parseFloat(value);
        break;

      case 'environment.outside.humidity':
        humidity = Math.round(100*parseFloat(value));
        break;
      */

      default:
        app.debug('Unknown path: ' + path);
    }
  }


  function calculateWindDirection() {
    
    let windHeading;
    let headingTrue = getKeyValue('navigation.headingTrue');
    let awa =  getKeyValue('environment.wind.angleApparent');

    app.debug(`calculateWindirection: HT ${headingTrue} AWA ${awa}`);
  
    if (headingTrue && awa) {

      windHeading = headingTrue + awa;

      if (windHeading > Math.PI * 2) 
        windHeading -= Math.PI * 2
      else if (windHeading < 0) 
        windHeading += Math.PI * 2

     }

     return windHeading;
  }

  function getKeyValue(key) {
    
    let Key = app.getSelfPath(key);
    if (!Key) {
        return null;
    }
    
    return Key.value;
  }

  function timeSince(date) {
    let seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) {
      return Math.floor(interval) + " years";
    }
    interval = seconds / 2592000;
    if (interval > 1) {
      return Math.floor(interval) + " months";
    }
    interval = seconds / 86400;
    if (interval > 1) {
      return Math.floor(interval) + " days";
    }
    interval = seconds / 3600;
    if (interval > 1) {
      let time = Math.floor(interval);
      if (time == 1) {
        return (`${time} hour`);
      } else {
	      return (`${time} hours`);
      }
    }
    interval = seconds / 60;
    if (interval > 1) {
      let time = Math.floor(interval);
      if (time == 1) {
        return (`${time} minute`);
      } else {
	      return (`${time} minutes`);
      }
    }
    return Math.floor(seconds) + " seconds";
  }

  return plugin;
}
