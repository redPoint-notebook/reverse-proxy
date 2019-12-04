require("dotenv").config();
const httpProxy = require("http-proxy");
const https = require("https");
const http = require("http");
const helpers = require('./helpers')
const ROOT = process.env.ROOT;
const db = require("./db");

let sessions = {};

const proxy = httpProxy.createProxyServer({
  // secure: true,
  ws: true,
  followRedirects: true
});

// ~~~~~~~~~~~~~~~

// const fs = require('fs');
// const https_options = {
//   key: fs.readFileSync('/etc/letsencrypt/live/willmills.dev/privkey.pem'),
//   cert: fs.readFileSync('/etc/letsencrypt/live/willmills.dev/fullchain.pem')
// }
// const httpsServer = https.createServer(https_options, (req, res) => {
//   const host = req.headers.host;
//   console.log('~~~~~ Inside HTTPS Server ~~~~');
//   console.log("Host: ", host);

//   res.writeHead(200);
//   res.end("We're up in HTTPS land!")

// })

// httpsServer.listen(443, () => {
//   console.log("Listening for secure connections on port 443...")
// })


// ~~~~~~~~~~~~~~~

const proxyServer = http.createServer((req, res) => {
  const host = req.headers.host;
  // www.redpointnotebook.com or
  // www.123abc.redpointnotebook.com

  if (host === ROOT) {
    console.log("===================================");
    console.log("Inside host === ROOT");
    console.log("Host : ", host);
    console.log("req.method : ", req.method);
    console.log("===================================");

    if (req.method === "GET") {
      helpers.startNewSession(req, res, sessions);
    }

    if (req.method === "POST" && req.url.match(/\/webhooks\/(.*)/)) {

      const matchData = req.url.match(/\/webhooks\/(.*)/);
      let notebookId;

      if (matchData) {
        notebookId = matchData[1];
      }

      console.log('Webhook notebook id is :', notebookId)

      let body = '';

      req.on("data", chunk => {
        body += chunk;
      });

      req.on("end", () => {
        const webhookData = JSON.parse(body);
        console.log(webhookData);

        db("WEBHOOK", null, notebookId, webhookData);
        res.writeHead(200);
        res.end()
      });
    }
  } else if (host !== ROOT) {
    // host === subdomained url
    console.log("===================================");
    console.log("Inside host !== ROOT")
    console.log("HOST :", host);
    console.log("===================================");
    if (req.method === "DELETE") {
      console.log("Delete Request received");
      // server.js issues delete request to tear down a container session
      helpers.tearDown(req, res, sessions);
    } else if (req.method === "POST" && (req.url === "/save" || req.url === "/clone")) {
      // save or clone notebook
      helpers.saveOrCloneNotebook(req, res, sessions);
    } else if (!sessions[host]) {
      // subdomain is not in the sessions object
      console.log("Could not find session")
      res.writeHead(404);
      return res.end();
    } else if (req.url === '/loadNotebook' && req.method === 'GET') {
      // load notebook from session state if stashed notebookId
      helpers.loadNotebook(req, res, sessions);
    } else {
      console.log("inside proxy!");
      sessions[host].lastVisited = Date.now();
      proxy.web(req, res, { target: sessions[req.headers.host].ip }, e => {
      });
    }
  }
});

helpers.teardownZombieContainers(sessions);

proxyServer.on("upgrade", (req, socket, head) => {
  console.log("===================================");
  console.log("Inside on('upgrade')")
  console.log("sessions[req.headers.host].ip : ", sessions[req.headers.host].ip)
  console.log("===================================");
  proxy.ws(req, socket, head, { target: sessions[req.headers.host].ip });
});

proxyServer.listen(80, () => {
  console.log("Listening on port 80...");
});
