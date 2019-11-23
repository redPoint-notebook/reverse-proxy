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

const ROOT = "www.redpointnotebook.club";
const ROOT2 = "redpointnotebook.club"
const PORT = 8000;

const proxy = httpProxy.createProxyServer({
  // secure: true,
  ws: true,
  followRedirects: true
});

const proxyServer = http.createServer((req, res) => {
  console.log("Request headers host: " + req.headers.host);
  // console.log("Headers: ", req.headers);

  const host = req.headers.host

  if (req.method === "DELETE") {
    console.log("From delete: ", sessions, req.headers);

    const containerId = sessions[req.headers.host].containerId;
    docker.getContainer(containerId).remove({ force: true });
    delete sessions[req.headers.host];
    res.writeHead(202);
    return res.end("DELETED");
  }

  if (host !== ROOT && !sessions[host]) {
    res.writeHead(404)
    return res.end()
  }

  if (host === ROOT) {
    console.log("host is ROOT");

    let sessionId = uuidv4().slice(0, 6);
    const html = fs.readFileSync(__dirname + "/redirect.html", {
      encoding: "utf-8"
    });

    const sessionURL = `www.${sessionId}.${ROOT2}`;
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
          sessions[sessionURL] = {  // www.asd443.redpoint.com
            ip: containerURL,  // http://172.11.78:8000
            containerId
          };

          console.log("Sessions object: " + JSON.stringify(sessions));
        });
      });
    });
  } else {
    proxy.web(req, res, { target: sessions[req.headers.host].ip }, e => {
      console.log('inside proxy!');
    });
  }

  proxyServer.on("upgrade", (req, socket, head) => {
    proxy.ws(req, socket, head, { target: sessions[req.headers.host].ip });
  });

});
proxyServer.listen(80, () => {
  console.log("Listening on port 80...");
});
