require("dotenv").config();
const db = require("./db");
const fs = require("fs");
const uuidv4 = require("uuid/v4");
const Docker = require("dockerode");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const nodemailer = require("nodemailer");
const fetch = require("node-fetch");
const redis = require("redis");
const client = redis.createClient();
const { promisify } = require("util");
const hexistsAsync = promisify(client.hexists).bind(client);

const ROOT_WITHOUT_SUBDOMAIN = process.env.ROOT_WITHOUT_SUBDOMAIN;
const PORT = process.env.PORT;
const IMAGE = process.env.IMAGE;
const EMAIL_SERVICE = process.env.EMAIL_SERVICE;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;

const transporter = nodemailer.createTransport({
  service: EMAIL_SERVICE,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASSWORD
  }
});

const sessionExists = async host => {
  return await hexistsAsync("dummySessions", host);
};

// const getSessionData = req => {
//   client.hget("dummySessions", req.headers.host, (err, string) => {
//     return JSON.parse(string);
//   });
// };

const getSessionData = req => {
  return new Promise((res, rej) => {
    client.hget("dummySessions", req.headers.host, (err, string) => {
      if (err) {
        rej(err);
      } else {
        res(JSON.parse(string));
      }
    });
  });
};

const saveOrCloneNotebook = (req, res, sessions) => {
  const isSave = /save/.test(req.url);
  let body = "";

  req.on("data", chunk => {
    body += chunk;
  });

  req.on("end", () => {
    const notebookData = JSON.parse(body);
    if (isSave) {
      getSessionData(req)
        .then(sessionData => {
          sessionData.notebookId = notebookData.id;
          client.hset("dummySessions", req.headers.host, sessionData);
        })
        .catch(err => {
          console.log(err);
        });
      // sessions[req.headers.host].notebookId = notebookData.id;
    }

    db("SAVE", notebookData, notebookData.id)
      .then(data => {
        console.log(data);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end("Save success!");
      })
      .catch(err => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(null);
      });
  });
};

const loadNotebook = (req, res, sessions) => {
  console.log("INSIDE LOAD NOTEBOOK");
  console.log("req.url", req.url);
  console.log("req.headers.host", req.headers.host);
  console.log("Sessions : ", sessions);
  console.log("===================================");

  getSessionData(req)
    .then(sessionData => {
      const notebookId = sessionData.notebookId;
      if (notebookId) {
        db("LOAD", null, notebookId).then(data => {
          log(`Loaded notebook : ${data}`);
          res.setHeader("Access-Control-Allow-Origin", "*");
          return res.end(JSON.stringify(data));
        });
      } else {
        res.end(JSON.stringify(null));
      }
    })
    .catch(err => {
      console.log(err);
    });

  // const notebookId = sessions[req.headers.host].notebookId;
};

const tearDown = (req, res, sessions) => {
  console.log("INSIDE TEARDOWN");

  getSessionData(req)
    .then(sessionData => {
      const lastVisit = sessionData.lastVisited;
      const containerId = sessionData.containerId;

      setTimeout(() => {
        getSessionData(req)
          .then(data => {
            if (lastVisit === data.lastVisited) {
              log("DELETING SESSION AND CONTAINER");
              docker.getContainer(containerId).remove({ force: true });
              client.hdel("dummySessions", req.headers.host);
              // delete sessions[req.headers.host];
              res.writeHead(202);
              return res.end("DELETED");
            }
          })
          .catch(err => {
            console.log(err);
          });
      }, 10000);
    })
    .catch(err => {
      console.log(err);
    });

  const session = getSessionData(req);
  const lastVisit = session.lastVisited;
  const containerId = session.containerId;
  setTimeout(() => {
    if (lastVisit === session.lastVisited) {
      log("DELETING SESSION AND CONTAINER");
      docker.getContainer(containerId).remove({ force: true });
      client.hdel("dummySessions", req.headers.host);
      // delete sessions[req.headers.host];
      res.writeHead(202);
      return res.end("DELETED");
    }
  }, 10000);
};

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
  const sessionURL = `${sessionId}.${ROOT_WITHOUT_SUBDOMAIN}`;
  const interpolatedHtml = html.replace("${}", `${sessionURL}`);

  res.end(interpolatedHtml);

  const options = {
    Image: IMAGE,
    ExposedPorts: { "8000/tcp": {} },
    HostConfig: {
      Runtime: "runsc",
      Memory: 100000000,
      CpuPeriod: 100000,
      CpuQuota: 100000
    }
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

        const sessionData = {
          // www.asd443.redpoint.com
          ip: containerURL, // http://172.11.78:8000
          containerId,
          notebookId: notebookId || null,
          lastVisited: Date.now()
        };

        client.hmset("dummySessions", sessionURL, JSON.stringify(sessionData));

        // sessions[sessionURL] = {
        //   // www.asd443.redpoint.com
        //   ip: containerURL, // http://172.11.78:8000
        //   containerId,
        //   notebookId: notebookId || null,
        //   lastVisited: Date.now()
        // };
        // console.log("Sessions object: " + JSON.stringify(sessions));

        setTimeout(() => {
          fetch(containerURL + "/checkHealth")
            .then(res => res.json())
            .then(({ webSocketEstablished }) => {
              if (!webSocketEstablished) {
                delete sessions[sessionURL];
                docker.getContainer(containerId).remove({ force: true });
              } else {
                // keep alive. do nothing
              }
            })
            .catch(err => {
              console.log("Error : ", err);
            });
        }, 30000);
      });
    });
  });
};

const teardownZombieContainers = () => {
  docker.listContainers((err, containers) => {
    containers.forEach(containerInfo => {
      docker.getContainer(containerInfo.Id).remove({ force: true });
    });
  });
};

const saveWebhook = (req, res) => {
  const matchData = req.url.match(/\/webhooks\/(.*)/);
  let notebookId;
  let body = "";

  if (matchData) {
    notebookId = matchData[1];
  }

  console.log("Webhook notebook id is :", notebookId);

  req.on("data", chunk => {
    body += chunk;
  });

  req.on("end", () => {
    const webhookData = JSON.parse(body);
    console.log(webhookData);

    db("WEBHOOK", null, notebookId, webhookData);
    res.writeHead(200);
    res.end();
  });
};

const log = (...messages) => {
  let date = new Date();
  messages = Array.from(messages);
  console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
  console.log(String(date));
  messages.forEach(mesg => console.log(mesg));
};

const sendEmail = (req, res) => {
  console.log("Request to send email received");
  let body = "";

  req.on("data", chunk => {
    body += chunk;
  });

  req.on("end", () => {
    const emailData = JSON.parse(body);

    const notebookURL = emailData.notebookURL;

    let emailHtml = fs.readFileSync(__dirname + "/email.html", {
      encoding: "utf-8"
    });

    emailHtml = emailHtml.replace("${}", emailData.operation);
    emailHtml = emailHtml.replace("$${}", emailData.notebookURL);

    const mailOptions = {
      from: EMAIL_USER, // sender address
      to: emailData.emailAddress, // list of receivers
      subject: "Your Redpoint Notebook URL", // Subject line
      html: emailHtml
    };

    transporter.sendMail(mailOptions, function(err, info) {
      if (err) {
        console.log("Error sending email: ", err);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHead(200);
        res.end("Error sending email");
      } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHead(200);
        res.end("Email sent");
      }
    });
  });
};

module.exports.saveOrCloneNotebook = saveOrCloneNotebook;
module.exports.loadNotebook = loadNotebook;
module.exports.startNewSession = startNewSession;
module.exports.tearDown = tearDown;
module.exports.teardownZombieContainers = teardownZombieContainers;
module.exports.saveWebhook = saveWebhook;
module.exports.sendEmail = sendEmail;
module.exports.log = log;
module.exports.sessionExists = sessionExists;
module.exports.getSessionData = getSessionData;
