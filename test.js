const querystring = require("querystring");

const string = "foo=bar&abc=xyz&abc=123";

const qsParsed = querystring.parse(string);
const jStringified = JSON.stringify(qsParsed);
const jParsed = JSON.parse(jStringified);

JSON.stringify(jParsed, null, 2);
console.log(JSON.stringify(jParsed, null, 2));
