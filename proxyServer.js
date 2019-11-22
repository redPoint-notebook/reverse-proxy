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
  debugger;
  console.log("Request headers host :" + req.headers.host);

  if (req.headers.host !== ROOT && !sessions[req.headers.host]) {
    res.writeHead(404);
    return res.end();
  }

  if (req.headers.host === ROOT && req.method === "GET") {
    console.log("GET request received");

    let sessionId = uuidv4().slice(0, 6);
    const html = require("fs").readFileSync(__dirname + "/redirect.html", {
      encoding: "utf-8"
    });

    const sessionURL = `${sessionId}.${ROOT}`;
    // const interpolatedHtml = html.replace("${}", `http://${sessionURL}`);
    const interpolatedHtml = html.replace("${}", `http://${ROOT}:${PORT}`);

    res.end(interpolatedHtml);

    const options = {
      Image: "csgdocker/one-server",
      PortBindings: {
        "8000/tcp": [{ HostPort: "8000" }]
      }
      // ExposedPorts: { "8000/tcp": {} }
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
          sessions[sessionURL] = {
            ip: containerURL,
            containerId
          };

          console.log("Sessions object: " + JSON.stringify(sessions));
        });
      });
    });
  }

  // proxy.web(req, res, { target: sessions[req.headers.host].ip }, e =>
  //   log_error(e, req)
  // );


  if (req.method === "DELETE") {
    console.log("DELETE request received");
    console.log("removing container with id: " + containerId);

    docker.getContainer(containerId).remove({ force: true });
    return res.end("Container deleted");
  }
});

proxyServer.listen(80, () => {
  console.log("Listening on port 80...");
});
