require("dotenv").config();
const db = require("./db");
const fs = require("fs");
const uuidv4 = require("uuid/v4");
const Docker = require("dockerode");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const ROOT_WITHOUT_SUBDOMAIN = process.env.ROOT_WITHOUT_SUBDOMAIN;
const PORT = process.env.PORT;
const IMAGE = process.env.IMAGE;

const saveOrCloneNotebook = (req, res, sessions) => {
  const isSave = /save/.test(req.url);
  let body = "";

  req.on("data", chunk => {
    body += chunk;
  });

  req.on("end", () => {
    const notebookData = JSON.parse(body);
    if (isSave) {
      sessions[req.headers.host].notebookId = notebookData.id;
    }

    db("SAVE", notebookData, notebookData.id).then(data => {
      console.log(data);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end("Save success!");
    }).catch(err => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(null);
    })
  });
}

const loadNotebook = (req, res, sessions) => {
  console.log("INSIDE LOAD NOTEBOOK");
  console.log("req.url", req.url);
  console.log("req.headers.host", req.headers.host);
  console.log("Sessions : ", sessions);
  console.log("===================================");
  const notebookId = sessions[req.headers.host].notebookId;
  if (notebookId) {
    db("LOAD", null, notebookId).then(data => {
      console.log("Loaded notebook : ", data);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.end(JSON.stringify(data));
    });
  } else {
    res.end(JSON.stringify(null));
  }
};

const tearDown = (req, res, sessions) => {
  console.log("INSIDE TEARDOWN!!");
  const session = sessions[req.headers.host];
  const lastVisit = session.lastVisited;
  const containerId = session.containerId;
  setTimeout(() => {
    if (lastVisit === session.lastVisited) {
      console.log("===================================");
      console.log("DELETING SESSION AND CONTAINER");
      // console.log("containerId : ", containerId);
      console.log("sessions : ", sessions);
      docker.getContainer(containerId).remove({ force: true });
      delete sessions[req.headers.host];
      console.log("sessions : ", sessions);
      console.log("===================================");
      res.writeHead(202);
      return res.end("DELETED");
    }
  }, 10000)
}

const startNewSession = (req, res, sessions) => {
  const matchData = req.url.match(/\/notebooks\/(.*)/);
  let notebookId;
  if (matchData) {
    notebookId = matchData[1];
  }

  console.log("Notebook ID : ", notebookId);

  const html = fs.readFileSync(__dirname + "/redirect.html", {
    encoding: "utf-8"
  });
  const sessionId = uuidv4().slice(0, 6);
  const sessionURL = `www.${sessionId}.${ROOT_WITHOUT_SUBDOMAIN}`;
  const interpolatedHtml = html.replace("${}", `http://${sessionURL}`);

  res.end(interpolatedHtml);

  const options = {
    Image: IMAGE,
    ExposedPorts: { "8000/tcp": {} }
  };

  docker.createContainer(options, (err, container) => {
    const containerId = container.id;
    console.log("Id of this container is " + containerId);

    container.start((err, data) => {
      if (err) console.log(err);
      container.inspect(container.id).then(data => {
        const IPAddress = data.NetworkSettings.IPAddress;
        console.log("IP address of this container is: " + IPAddress);

        const containerURL = `http://${IPAddress}:${PORT}`;
        sessions[sessionURL] = {
          // www.asd443.redpoint.com
          ip: containerURL, // http://172.11.78:8000
          containerId,
          notebookId: (notebookId || null),
          lastVisited: Date.now(),
        };

        console.log("Sessions object: " + JSON.stringify(sessions));
      });
    });
  });
}

module.exports.saveOrCloneNotebook = saveOrCloneNotebook;
module.exports.loadNotebook = loadNotebook;
module.exports.startNewSession = startNewSession;
module.exports.tearDown = tearDown;