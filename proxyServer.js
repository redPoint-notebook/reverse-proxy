require("dotenv").config();
const httpProxy = require("http-proxy");
const https = require("https");
const http = require("http");
import {
  saveOrCloneNotebook,
  loadNotebook,
  tearDown,
  startNewSession
} from "./utils";
const ROOT = process.env.ROOT;

let containerId;
let IPAddress;
let sessions = {};

const proxy = httpProxy.createProxyServer({
  // secure: true,
  ws: true,
  followRedirects: true
});

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
      startNewSession(req, res);
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
      tearDown(req, res);
    } else if (req.method === "POST" && (req.url === "/save" || req.url === "/clone")) {
      // save or clone notebook
      saveOrCloneNotebook(req, res, sessions);
    } else if (!sessions[host]) {
      // subdomain is not in the sessions object
      res.writeHead(404);
      return res.end();
    } else if (req.url === '/loadNotebook' && req.method === 'GET') {
      // load notebook from session state if stashed notebookId
      loadNotebook(req, res, sessions);
    } else {
      console.log("inside proxy!");
      sessions[host].lastVisited = Date.now();
      proxy.web(req, res, { target: sessions[req.headers.host].ip }, e => {
      });
    }
  }
});

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


