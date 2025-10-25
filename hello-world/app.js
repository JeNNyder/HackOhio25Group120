/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html 
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 * 
 */

exports.lambdaHandler = async (event) => {
  const q = event.queryStringParameters || {};
  const route = q.route || "CC";
  const stop  = q.stop  || "Union";

  // Build the JSON response
  // For now we return mock (fake) data to simulate crowd levels
  // Later you can replace this with logic that queries DynamoDB or other sources
  const responseBody = {
    route,                // Bus route name
    stop,                 // Bus stop name
    level: 3,             // Crowding level: 1=not busy, 4=packed
    headcount_est: 42,    // Estimated number of passengers
    confidence: "med",    // Confidence level of the estimation
    ts: Date.now()        // Timestamp (milliseconds since epoch)
  };

  // Return an HTTP 200 OK response with a JSON body
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(responseBody)
  };
};
  