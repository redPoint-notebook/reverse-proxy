const httpProxy = require("http-proxy");
const fs = require("fs");
const https = require("https");
const http = require("http");
const uuidv4 = require("uuid/v4");
const Docker = require("dockerode");
let docker = new Docker({ socketPath: "/var/run/docker.sock" });


let containerId;
let IPAddress;
let sessions = {};

const ROOT = "167.99.145.236";
const PORT = 8000;

const proxy = httpProxy.createProxyServer({
  secure: true,
  ws: true,
  followRedirects: true
});

const proxyServer = http.createServer((req, res) => {
  console.log("Request headers host :" + req.headers.host);
  console.log("Request url: " + req.url);

  if (req.headers.host === ROOT) {

    if (req.url === '/favicon.ico') {
      res.writeHead(404);
      return res.end();
    }

    if (req.url !== '/' && !sessions[req.url]) {
      res.writeHead(404);
      return res.end();
    }

    console.log("ROOT path reached");


    if (req.method === "DELETE") {
      console.log("DELETE request received");
      console.log("removing container with id: " + containerId);

      docker.getContainer(containerId).remove({ force: true });
      return res.end("Container deleted");
    }

    let sessionId = uuidv4().slice(0, 6);
    const html = require("fs").readFileSync(__dirname + "/redirect.html", {
      encoding: "utf-8"
    });

    const sessionURL = `${ROOT}/${sessionId}`;
    const interpolatedHtml = html.replace("${}", `http://${sessionURL}`);

    res.end(interpolatedHtml);

    const options = {
      Image: "csgdocker/one-server",
      // PortBindings: {
      //   "8000/tcp": [{ HostPort: "8000" }]
      // }
      ExposedPorts: { "8000/tcp": {} }
    };

    docker.createContainer(options, (err, container) => {
      containerId = container.id;
      console.log("Id of this container is " + containerId);

      container.start((err, data) => {
        if (err) console.log(err);
        container.inspect(container.id).then(data => {
          IPAddress = data.NetworkSettings.IPAddress;
          console.log("IP address of this container is: " + IPAddress);

          const containerURL = `http://${IPAddress}:${PORT}`;
          sessions[`/${sessionId}`] = {
            ip: containerURL,
            containerId
          };

          console.log("Sessions object: " + JSON.stringify(sessions));
        });
      });
    });
  } else {
    proxy.web(req, res, { target: sessions[req.url].ip }, e => {
      debugger;
      console.log('inside proxy!');
    });
  }

});
proxyServer.listen(80, () => {
  console.log("Listening on port 80...");
});
