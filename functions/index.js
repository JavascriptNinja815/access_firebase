// import * as firebase from "firebase/app";

// import "firebase/auth";
// import "firebase/database";

var admin = require("firebase-admin");
var functions = require("firebase-admin")
admin.initializeApp();
// var serviceAccount = require("./ref/jabmix-162f2-firebase-adminsdk-9z4kr-dcd41408be.json");

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//   databaseURL: "https://jabmix-162f2.firebaseio.com"
// });


const RequestStatus = {
  "pending": "PENDING", // The SENDER is waiting on the RECIPIENT
  "accepted": "ACCEPTED", // The RECIPIENT has ACCEPTED the SENDERs the request
  "denied": "DENIED" // The RECIPIENT has DENIED the SENDERs the request
};

exports.removeExpiredRequests = functions.https.onRequest(async (req, res) => {
  const key = req.query.key;

  // Exit if the keys don't match.
  if (!secureCompare(key, functions.config().cron.key)) {
    console.log('The key provided in the request does not match the key set in the environment. Check that', key,
        'matches the cron.key attribute in `firebase env:get`');
    res.status(403).send('Security key does not match. Make sure your "key" URL query parameter matches the ' +
        'cron.key environment variable.');
    return null;
  }
  const expiredRequests = await getExpiredRequests();
  console.log(expiredRequests);  
})
async function getExpiredRequests(requests = []) {
  const allRequests = await functions.database.ref('/requests')
  return allRequests
}