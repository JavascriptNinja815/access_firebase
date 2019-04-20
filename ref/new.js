

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

  const expiredRequests = await getExpiredRequests()

  const successedRequests = removeExpiredRequests(expiredRequests)
  console.log(successedRequests);
})
function removeExpiredRequests(expiredRequests) {
  if (expiredRequests.length > 0) {
    // expiredRequests.forEach(request, index) => {
    //   request.remove();
    // }
    const requestToDelete = expiredRequests.pop()
    var id = requestToDelete.remove()
    // return functions.database.ref(`/request/${id}`).remove()
  }
}

async function getExpiredRequests() {
  const allRequests = await functions.database.ref('/requests')
  const expiredRequests = allRequests.filter(request => {
    if ((request.status === RequestStatus.pending) && (Date.parse(request.createdDate) < (Date.now() - 7 * 24 * 60 * 60 * 1000))) {
      return true
    }
    return false
  }
  )

  return expiredRequests
}

function getExpiredRequests() {
  var ref = database.ref('/requests');
  ref.once('value').then(snapshot => {
    var requests = snapshot.val();
    for (var request in requests) {
      
    }
    requests.filter(request => {
      if ((request.status === RequestStatus.pending) && (Date.parse(request.createdDate) < (Date.now() - 1 * 24 * 60 * 60 * 1000))) {
        return true
      }
      return false
    })
    console.log(requests);
    return requests;
  }).catch(error => {
    console.log(error);
    return;
  });
  return ref;
}