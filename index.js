//AWS Lambda Script to send S3 logs to Loggly

/** 
 * To setup your encrypted Loggly Customer Token inside the script use the following steps 
 * 1. Create a KMS key - http://docs.aws.amazon.com/kms/latest/developerguide/create-keys.html
 * 2. Encrypt the Loggly Customer Token using the AWS CLI
 *        aws kms encrypt --key-id alias/<your KMS key arn> --plaintext "<your loggly customer token>"
 * 3. Copy the base-64 encoded, encrypted token from step 2's CLI output (CiphertextBlob attribute) and 
 *    paste it in place of the 'your KMS encypted key' below in line 31
 */

var aws = require('aws-sdk')
var s3 = new aws.S3({apiVersion: '2006-03-01'})

var _ = require('lodash')
, async = require('async')
, request = require('request')
, Transform = require('stream').Transform
, csv = require('csv-streamify')
, JSONStream = require('JSONStream')

// loggly url, token and tag configuration
var logglyConfiguration = {

	//change it to https if secured connection is required. http is recommended as it is faster than https
    hostName: 'http://logs-01.loggly.com/bulk/',
	
	//add more tags by separating through comma e.g. tag1,tag2
    tags: 'S3ToLoggly'
};

// use KMS to decrypt customer token
var decryptParams = {
    CiphertextBlob: new Buffer('your KMS encypted key', 'base64')
};

var kms = new aws.KMS({
    apiVersion: '2014-11-01'
});

//decrypt the kms key and get the loggly customer token
kms.decrypt(decryptParams, function (error, data) {
    if (error) {
        logglyConfiguration.tokenInitError = error;
        console.log(error);
    } else {
        logglyConfiguration.customerToken = data.Plaintext.toString('ascii');
    }
});

exports.handler = function(event, context) {

	// Get the object from the event and show its content type
    var bucket = event.Records[0].s3.bucket.name;
    var key  = event.Records[0].s3.object.key;
    var size = event.Records[0].s3.object.size;

	if ( size == 0 ) {
        console.log('S3ToLoggly skipping object of size zero');
    } 
    else {
      function parseAndSendEventsToLoggly(){
        //checking if decrypted the customer token
         if (!logglyConfiguration.customerToken) {
          if (logglyConfiguration.tokenInitError) {
            console.log('error in decrypt the token. Not retrying.');
            return context.fail(logglyConfiguration.tokenInitError);
          }
          
          //if not found then recheck after 100 ms
          setTimeout(function () { parseAndSendEventsToLoggly() }, 100);
          return;
        }
        
        // Download the logfile from S3, and upload to loggly.
        async.waterfall([
          function buckettags(next) {
            var params = {
              Bucket: bucket /* required */
            };
            
            LOGGLY_URL = logglyConfiguration.hostName + logglyConfiguration.customerToken + '/tag/' + encodeURIComponent(logglyConfiguration.tags);
            s3.getObject({
              Bucket: bucket,
              Key: key
            }, next);
          },

          function upload(data, next) {
            
            // Stream the logfile to loggly.
            var bufferStream = new Transform();
            bufferStream.push(data.Body)
            bufferStream.end()
            bufferStream.pipe(request.post(LOGGLY_URL)).on('error', function(err) {next(err)}).on('end', function() {next()})
          }
        ], 
        function (err) {
          if (err) {
            console.error(
            'Unable to read ' + bucket + '/' + key +
            ' and upload to loggly' +
            ' due to an error: ' + err
            );
            context.fail();
          } else {
            console.log(
            'Successfully uploaded ' + bucket + '/' + key +
            ' to ' + LOGGLY_URL
            );
          }
          context.done();
        });
      }
      parseAndSendEventsToLoggly();
    }
};
