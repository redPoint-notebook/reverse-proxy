const httpProxy = require("http-proxy");
const fs = require("fs");
const https = require("https");
const http = require("http");
const uuidv4 = require("uuid/v4");
const Docker = require("dockerode");
let docker = new Docker({ socketPath: "/var/run/docker.sock" });

const proxyServer = http.createServer((req, res) => {
  if (req.method === "GET") {
    console.log("Request headers host :" + req.headers.host);
  }
});

proxyServer.listen(80);
