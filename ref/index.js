const util = require('util');
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const stripe = require('stripe')(functions.config().stripe.testkey)

const database = admin.database();

const RequestStatus = {
  "pending": "PENDING", // The SENDER is waiting on the RECIPIENT
  "accepted": "ACCEPTED", // The RECIPIENT has ACCEPTED the SENDERs the request
  "denied": "DENIED" // The RECIPIENT has DENIED the SENDERs the request
};

const RequestResponseMessage = {
  "pending": "jabbed you.",
  "accepted": "accpeted your jab",
  "denied": "denied your jab"
};

/*
    Handles newly created requests
    The procedure is as follows:
        1) Add the request to the RECIPIENTs list of received requests
        2) Send a notification to the RECIPIENT of the new request
*/

exports.requestCreated = functions.database.ref('/requests/{id}').onWrite(event => {

  const requestKey = event.after.key;
  const senderUID = event.after.val().sender;
  console.log("senderUID = ");
  console.log(senderUID);
  const recipientUID = event.after.val().recipient;
  console.log("recipientUID = ");
  console.log(recipientUID);
  const name = event.after.val().name;
  const status = event.after.val().status;
  const message = event.after.val().message;

  const promises = [
    database.ref(`/sentRequests/${senderUID}/${requestKey}`).set(status),
    database.ref(`/receivedRequests/${recipientUID}/${requestKey}`).set(status)
  ];

  return Promise.all(promises).then(result => {

    const sorted = [senderUID, recipientUID].sort();
    const alphaParticipant = sorted[0];
    const betaParticipant = sorted[1];
    const conversationKey = `${alphaParticipant}:${betaParticipant}`;
    const messageKey = database.ref(`/conversations/threads/${conversationKey}`).push().key;
    var messagesObject = {};
    messagesObject[messageKey] = {
      "sender": senderUID,
      "senderName": name,
      "recipient": recipientUID,
      "text": message,
      "timestamp": admin.database.ServerValue.TIMESTAMP
    }

    var updateObject = {};
    updateObject[`/conversations/threads/${conversationKey}`] = messagesObject

    updateObject[`/conversations/users/${recipientUID}/${senderUID}`] = {
      "key": conversationKey,
      "sender": senderUID,
      "recipient": recipientUID,
      "text": message,
      "timestamp": admin.database.ServerValue.TIMESTAMP,
      "muted": false,
      "seen": false
    };

    updateObject[`/conversations/users/${senderUID}/${recipientUID}`] = {
      "key": conversationKey,
      "sender": senderUID,
      "recipient": recipientUID,
      "text": message,
      "timestamp": admin.database.ServerValue.TIMESTAMP,
      "muted": false,
      "seen": true
    };

    const setConversation = database.ref().update(updateObject);

    return setConversation.then(result => {
      // 2
      var pushNotificationPayload = {
        "notification": {
          "type": "REQUEST",
          "body": `${name} ${RequestResponseMessage.pending}`,
          "sound": "default"
        }
      };


      return sendPushNotificationToUser(recipientUID, pushNotificationPayload);
    });

  }).catch(error => {
    console.log(error);
    return;
  });

});

/*
    Handles status updates to requests
    The procedure is as follows:
        1) If the request has not been ACCEPTED or DENIED, do nothing
        2) Otherwise, update the status of the SENT request
        3) Get the USERNAME of the SENDER (to be used as part of the push notification)
        4) Send a notification to the SENDER (of the original request) of the status change
*/
exports.requestUpdated = functions.database.ref('/requests/{key}').onWrite(event => {
  const requestKey = event.after.key;
  const senderUID = event.after.val().sender;
  const recipientUID = event.after.val().recipient;
  const status = event.after.val().status;
  const message = event.after.val().message;
  const chargeId = event.after.val().chargeId;
  // 1)
  if (status !== RequestStatus.accepted && status !== RequestStatus.denied) {
    return Promise.resolve()
  }

  // 2
  const promises = [
    database.ref(`/sentRequests/${senderUID}/${requestKey}`).set(status),
    database.ref(`/receivedRequests/${recipientUID}/${requestKey}`).set(status)
  ];

  return Promise.all(promises).then(results => {

    // 3

    console.log("recipientUID = ");
    console.log(recipientUID);
    let recipientName = database.ref(`/users/${recipientUID}/firstLastName`).once('value');
    if (recipientName === null) {
      recipientName = database.ref(`/trainer/${recipientUID}/firstLastName`).once('value');
    }
    return recipientName;

  }).then(snapshot => {
    console.log("ssnapshot = ");
    console.log(snapshot);
    const name = snapshot.val();
    console.log("sender name = ");
    console.log(name);
    // 4
    var pushNotificationPayload = {};

    if (status === RequestStatus.accepted) {

      console.log("chargeId = ");
      console.log(chargeId);
      pushNotificationPayload = {
        "notification": {
          "type": "REQUEST_ACCEPTED",
          "body": `${name} ${RequestResponseMessage.accepted}`,
          "sound": "default"
        }
      };

      stripe.charges.capture(chargeId, (err, charge) => {

        console.log("capture value = ")
        console.log(charge)

        if (err === null) {
          return sendPushNotificationToUser(senderUID, pushNotificationPayload);
        }
      });
      return sendPushNotificationToUser(1, pushNotificationPayload);

    } else if (status === RequestStatus.denied) {

      pushNotificationPayload = {
        "notification": {
          "type": "REQUEST_DENIED",
          "body": `${name} ${RequestResponseMessage.denied}`,
          "sound": "default"
        }
      };

      return sendPushNotificationToUser(senderUID, pushNotificationPayload);

    } else {
      return sendPushNotificationToUser(1, pushNotificationPayload);
    }



  });

});

exports.newMessage = functions.database.ref('/conversations/threads/{conversationKey}/{messageKey}').onWrite(event => {

  const data = event.after.val();
  console.log(data);
  const recipientUID = data.recipient;
  const senderUID = data.sender;
  const senderName = data.senderName;
  const text = data.text;
  const timestamp = data.timestamp;

  const sorted = [senderUID, recipientUID].sort();
  const alphaParticipant = sorted[0];
  const betaParticipant = sorted[1];
  const key = `${alphaParticipant}:${betaParticipant}`;

  var updateObject = {};
  updateObject[`/conversations/users/${recipientUID}/${senderUID}/key`] = key;
  updateObject[`/conversations/users/${recipientUID}/${senderUID}/sender`] = senderUID;
  updateObject[`/conversations/users/${recipientUID}/${senderUID}/recipient`] = recipientUID;
  updateObject[`/conversations/users/${recipientUID}/${senderUID}/text`] = text;
  updateObject[`/conversations/users/${recipientUID}/${senderUID}/timestamp`] = timestamp;
  updateObject[`/conversations/users/${recipientUID}/${senderUID}/seen`] = false;
  updateObject[`/conversations/users/${recipientUID}/${senderUID}/muted`] = false;

  updateObject[`/conversations/users/${senderUID}/${recipientUID}/key`] = key;
  updateObject[`/conversations/users/${senderUID}/${recipientUID}/sender`] = senderUID;
  updateObject[`/conversations/users/${senderUID}/${recipientUID}/recipient`] = recipientUID;
  updateObject[`/conversations/users/${senderUID}/${recipientUID}/text`] = text;
  updateObject[`/conversations/users/${senderUID}/${recipientUID}/timestamp`] = timestamp;
  updateObject[`/conversations/users/${senderUID}/${recipientUID}/seen`] = true;
  updateObject[`/conversations/users/${senderUID}/${recipientUID}/muted`] = false;

  const update = database.ref().update(updateObject);
  return update.then(result => {

    const isRecipientMuted = database.ref(`/conversations/users/${recipientUID}/${senderUID}/muted`).once('value');

    return isRecipientMuted.then(mutedResults => {
      const muted = mutedResults.val();
      if (muted) {
        return;
      }

      var pushNotificationPayload = {
        "notification": {
          "type": "NEW_MESSAGE",
          "body": `${senderName}: ${text}`,
          "sound": "default"
        }
      };

      return sendPushNotificationToUser(recipientUID, pushNotificationPayload);

    });

  });

});

exports.hourly_job = functions.pubsub
  .topic('hourly-tick')
  .onPublish((message) => {
    console.log("==================== This function is run every hour! ======================");
    if (message.data) {
      const dataString = Buffer.from(message.data, 'base64').toString();
      console.log(`Message Data: ${dataString}`);
    }
    const expiredRequests = getExpiredRequests()
    return true;
  });

function getExpiredRequests() {
  var ref = database.ref('/requests');
  var expiredRequests = [];

  ref.once('value').then(snapshot => {
    var requests = snapshot.val();

    Object.keys(requests).forEach(function (key) {
      var value = requests[key];
      if (value.hasOwnProperty('createdDate')) {
        // 1 * 1 * 10 * 60 * 1000 10min for test
        //7 * 24 * 60 * 60 * 1000 7day
        if ((value.status === "PENDING") && (value.timestamp < (Date.now() - 7 * 24 * 60 * 60 * 1000))) {
          expiredRequests.push(key)
        }
      }

    });
    console.log("Expire Requests List = ", expiredRequests);
    var pushNotificationPayload = {
      "notification": {
        "type": "REQUEST",
        "body": "Request Expired!!",
        "sound": "default"
      }
    };

    expiredRequests.forEach(id => {

      database.ref('/sentRequests/' + requests[id].sender + '/' + id).remove()
        .then(() => {
          console.log("removing from sentRequests success");
          sendPushNotificationToUser(requests[id].sender, pushNotificationPayload);
          return true;
        })
        .catch(error => {
          console.log("removing from sentRequests failed")
          return false;
        })

      database.ref('/receivedRequests/' + requests[id].recipient + '/' + id).remove()
        .then(() => {
          console.log("removing from receivedRequests success");
          sendPushNotificationToUser(requests[id].recipient, pushNotificationPayload);
          return true;
        })
        .catch(error => {
          console.log("removing from receivedRequests failed")
          return false;
        })
    })

    expiredRequests.forEach(id => {
      database.ref('/requests/' + id).remove()
        .then(() => {
          console.log("removing from requests success");
          return true;
        })
        .catch(error => {
          console.log("removing from requests failed")
          return false;
        })
    })

    return expiredRequests;
  }).catch(error => {
    console.log("foreach error");
    console.log(error);
    return;
  });
}

exports.makePayment = functions.database.ref('/payments/{paymentId}').onWrite(event => {

  const payment = event.after.val();
  console.log(payment);
  const paymentId = event.after.key;

  // checks if payment exists or if it has already been charged
  if (!payment || payment.charge) return;

  return admin.database().ref(`/payments/${paymentId}`).once('value').then(snapshot => {
    return snapshot.val();
  }).then(payment => {

    const capture = false;
    const amount = payment.amount;
    const idempotency_key = paymentId;  // prevent duplicate charges
    const source = payment.token.id;
    const currency = 'usd';
    const charge = { capture, amount, currency, source };

    return stripe.charges.create(charge, { idempotency_key });

  }).then(charge => {
    return admin.database().ref(`/payments/${paymentId}/charge`).set(charge)
  });
});

/*
    Sends a push notification to the specified user with a given payload
    The procedure is as follows:
        1) Get the users Firebase Cloud Messaging Token (FCMToken)
        2) Get the number of PENDING requests for the user (this is used for the App Icon Badge Number)
        3) Send the payload
*/
function sendPushNotificationToUser(uid, payload) {

  var token = "";
  var badgeCount = 0;

  // 1
  const getUserToken = database.ref(`FCMToken/${uid}`).once('value');

  return getUserToken.then(tokenSnapshot => {
    if (tokenSnapshot.val() === null) {
      return Promise.reject(new Error("No token found"));
    }

    token = tokenSnapshot.val();

    // 2
    const getPendingRequests = database.ref(`receivedRequests/${uid}`).orderByValue().equalTo(RequestStatus.pending).once('value');
    return getPendingRequests;

  }).then(pendingRequestsSnapshot => {
    if (pendingRequestsSnapshot.val()) {
      badgeCount += pendingRequestsSnapshot.numChildren();
    }

    console.log("badgeCount 2 = ");
    console.log(badgeCount);
    const getUnseenConversations = database.ref(`conversations/users/${uid}`).orderByChild('seen').equalTo(false).once('value');
    return getUnseenConversations;

  }).then(unseenConversationsSnapshot => {
    if (unseenConversationsSnapshot.val()) {
      badgeCount += unseenConversationsSnapshot.numChildren();
    }

    console.log("badgeCount 1 = ");
    console.log(badgeCount);

    payload.notification.badge = `${badgeCount}`;

    // 3
    return admin.messaging().sendToDevice(token, payload).then(response => {

      const tokensToRemove = [];

      response.results.forEach((result, index) => {
        const error = result.error;

        if (error) {
          console.error('Failure sending notification to', token, error);

        } else {
          console.log("Push Notification Sent")
        }
      });
      return null;
    });
  });
}
