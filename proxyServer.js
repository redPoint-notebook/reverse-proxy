require("dotenv").config();
const httpProxy = require("http-proxy");
const https = require("https");
const http = require("http");
const helpers = require("./helpers");
const ROOT = process.env.ROOT;
const SSLKEY = process.env.SSLKEY;
const SSLCERT = process.env.SSLCERT;
const SESSIONS_OBJ = process.env.SESSIONS_OBJ;
const REDIS_PW = process.env.REDIS_PW;
const fs = require("fs");
const redis = require("redis");
const client = redis.createClient({ auth_pass: REDIS_PW });
const fetch = require("node-fetch");

const proxyToHTTPSServer = httpProxy.createProxyServer();

const proxy = httpProxy.createProxyServer({
  secure: true,
  ws: true,
  followRedirects: true
});

// ~~~~~~~~~~~~~~~
// Redirect all traffic from http to https
const httpServer = http.createServer((req, res) => {
  helpers.log("Inside httpServer, req.headers.host =", req.headers.host);

  if (/redpointnotebooks/.test(req.headers.host)) {
    helpers.log("Redirecting to HTTPS");
    proxyToHTTPSServer.web(req, res, {
      target: `https://${req.headers.host}${req.url}`
    });
  } else {
    res.writeHead(404);
    return res.end();
  }
});

httpServer.listen(80, () => {
  helpers.log("HTTP Redirect server listening on port 80...");
});
// ~~~~~~~~~~~~~~~

const https_options = {
  key: fs.readFileSync(SSLKEY),
  cert: fs.readFileSync(SSLCERT)
};

const proxyServer = https.createServer(https_options, (req, res) => {
  const host = req.headers.host;
  // www.redpointnotebooks.com or
  // www.123abc.redpointnotebooks.com

  helpers
    .getSessionData(req)
    .then(sessionData => {
      if (host === ROOT) {
        helpers.log(
          "Inside host === ROOT",
          `Host: ${host}`,
          `req.method: ${req.method}`,
          req.method
        );

        if (req.method === "GET") {
          helpers.startNewSession(req, res);
        } else if (req.method === "POST") {
          if (req.url.match(/\/webhooks\/(.*)/)) {
            helpers.addMessage(req, res);
          } else if (req.url === "/email") {
            helpers.sendEmail(req, res);
          }
        }
      } else if (host !== ROOT) {
        // host === subdomained url
        helpers.log("Inside host !== ROOT", `HOST: ${host}`);
        console.log(`Request URL: ${req.url}`);
        console.log(`Request Method: ${req.method}`);

        if (req.method === "DELETE") {
          console.log("Delete Request received");
          // server.js issues delete request to tear down a container session
          helpers.tearDown(req, res);
        } else if (
          req.method === "POST" &&
          (req.url === "/save" || req.url === "/clone")
        ) {
          // save or clone notebook
          helpers.saveOrCloneNotebook(req, res);
        } else if (!sessionData) {
          // subdomain is not in the sessions object
          console.log("Could not find session");
          res.writeHead(404);
          return res.end();
        } else if (req.url === "/loadNotebook" && req.method === "GET") {
          // load notebook from session state if stashed notebookId
          helpers.loadNotebook(req, res);
        } else if (
          // this is a request to see if container is ready yet
          req.url === "/checkContainerHealth" &&
          req.method === "GET"
        ) {
          // check to see if docker container is ready
          helpers.getSessionData(req).then(sessionData => {
            helpers.log(
              `Sending internal fetch request to: ${sessionData.ip +
                "/checkHealth"}`
            );
            fetch(sessionData.ip + "/checkHealth")
              .then(containerResponse => {
                console.log(
                  `Received Container Status: ${containerResponse.status}`
                );
                console.log("TYPEOF STATUS: ", typeof containerResponse.status);
                req.on("error", err => {
                  console.log("Caught in error listener", err);
                });
                res.statusCode(containerResponse.status);
                res.end();
              })
              .catch(err => console.log("Caught in catch block", err));
          });
        } else {
          // this should not be an else branch, else should respond with 404
          // examine headers / message and perform conditional check to confirm it is a ws msg before proxying
          console.log("Proxying request through websocket");

          helpers
            .getSessionData(req)
            .then(sessionData => {
              sessionData.lastVisited = Date.now();
              client.hset(
                SESSIONS_OBJ,
                req.headers.host,
                JSON.stringify(sessionData),
                (err, result) => {
                  proxy.web(req, res, { target: sessionData.ip }, e => {});
                }
              );
            })
            .catch(err => {
              console.log(err);
            });
        }
      }
    })
    .catch(err => {});
});

helpers.teardownZombieContainers();
helpers.createQueue();

proxyServer.on("upgrade", (req, socket, head) => {
  console.log("Inside Upgrade Listener");
  helpers
    .getSessionData(req)
    .then(sessionData => {
      if (sessionData) {
        proxy.ws(req, socket, head, { target: sessionData.ip });
      }
    })
    .catch(err => {
      console.log(err);
    });
});

proxyServer.listen(443, () => {
  helpers.log("Listening on port 443...");
});
