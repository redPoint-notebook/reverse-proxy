require("dotenv").config();
const db = require("./db");
const fs = require("fs");
const uuidv4 = require("uuid/v4");
const Docker = require("dockerode");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const fetch = require("node-fetch");
const redis = require("redis");
const REDIS_PW = process.env.REDIS_PW;
const client = redis.createClient({ auth_pass: REDIS_PW });
const RedisSMQ = require("rsmq");
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const ROOT_WITHOUT_SUBDOMAIN = process.env.ROOT_WITHOUT_SUBDOMAIN;
const PORT = process.env.PORT;
const IMAGE = process.env.IMAGE;
const EMAIL_USER = process.env.EMAIL_USER;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT;
const NAMESPACE = process.env.NAMESPACE;
const QUEUENAME = process.env.QUEUENAME;
const SESSIONS_OBJ = process.env.SESSIONS_OBJ;

const rsmq = new RedisSMQ({
  host: REDIS_HOST,
  port: REDIS_PORT,
  ns: NAMESPACE,
  auth_pass: REDIS_PW
});

const getSessionData = req => {
  return new Promise((res, rej) => {
    client.hget(SESSIONS_OBJ, req.headers.host, (err, string) => {
      if (err) {
        rej(err);
      } else {
        let parsedSessionData = JSON.parse(string);
        console.log("parsedSessionData : ", parsedSessionData);
        res(parsedSessionData);
      }
    });
  });
};

const saveOrCloneNotebook = (req, res) => {
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
          client.hset(
            SESSIONS_OBJ,
            req.headers.host,
            JSON.stringify(sessionData)
          );
        })
        .catch(err => {
          console.log(err);
        });
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

const loadNotebook = (req, res) => {
  console.log("INSIDE LOAD NOTEBOOK");
  console.log("req.url", req.url);
  console.log("req.headers.host", req.headers.host);
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
};

const tearDown = (req, res) => {
  console.log("INSIDE TEARDOWN");

  getSessionData(req)
    .then(sessionData => {
      const lastVisit = sessionData.lastVisited;
      const containerId = sessionData.containerId;

      setTimeout(() => {
        console.log("Inside setTimeout for Teardown");
        getSessionData(req)
          .then(data => {
            if (lastVisit === data.lastVisited) {
              log("DELETING SESSION AND CONTAINER");
              docker.getContainer(containerId).remove({ force: true });
              client.hdel(SESSIONS_OBJ, req.headers.host);
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
};

const startNewSession = (req, res) => {
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
  let interpolatedHtml = html.replace("${}", `${sessionURL}`);
  // const interpolatedHtml = html.replace(/\$\{\}/g, `${sessionURL}`);

  // res.end(interpolatedHtml);

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

  docker
    .createContainer(options, (err, container) => {
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

          client.hmset(SESSIONS_OBJ, sessionURL, JSON.stringify(sessionData));

          setTimeout(() => {
            fetch(containerURL + "/checkHealth")
              .then(res => res.json())
              .then(({ webSocketEstablished }) => {
                if (!webSocketEstablished) {
                  client.hdel(SESSIONS_OBJ, sessionURL);
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
    })
    .then(container => {
      interpolatedHtml = interpolatedHtml.replace("#{}", "1");
      res.end(interpolatedHtml);
    });
};

const teardownZombieContainers = () => {
  docker.listContainers((err, containers) => {
    client.hvals(SESSIONS_OBJ, (err, sessionData) => {
      const allSessionData = sessionData.map(val => JSON.parse(val));
      const sessionContainerIds = allSessionData.map(data => data.containerId);
      log("session container Ids : ", sessionContainerIds);

      // kill container if no session exists
      containers.forEach(containerInfo => {
        if (!sessionContainerIds.includes(containerInfo.Id)) {
          docker.getContainer(containerInfo.Id).remove({ force: true });
        }
      });
    });
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

    let emailHtml = fs.readFileSync(__dirname + "/email.html", {
      encoding: "utf-8"
    });

    const title = emailData.title;

    emailHtml = emailHtml.replace("${operation}", emailData.operation);
    emailHtml = emailHtml.replace("${url}", emailData.notebookURL);
    emailHtml = emailHtml.replace("${title}", title);

    const msg = {
      to: emailData.emailAddress,
      from: EMAIL_USER,
      subject: `Link To Your Redpoint Notebook, '${title}'`,
      html: emailHtml
    };

    sgMail
      .send(msg)
      .then(() => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHead(200);
        res.end("Email sent");
      })
      .catch(error => {
        const errorString = "Error sending email: " + error.toString();
        console.log(errorString);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHead(200);
        res.end(errorString);
      });
  });
};

const createQueue = () => {
  rsmq.createQueue({ qname: QUEUENAME }, err => {
    if (err) {
      if (err.name !== "queueExists") {
        console.error(err);
        return;
      } else {
        console.log("The queue exists. That's OK.");
      }
    }
    console.log("queue created");
  });
};

const addMessage = (req, res) => {
  const matchData = req.url.match(/\/webhooks\/(.*)/);
  const contentType = req.headers["content-type"];

  let notebookId;
  let body = "";

  if (matchData) {
    notebookId = matchData[1];
  }

  req.on("data", chunk => {
    body += chunk;
  });

  req.on("end", () => {
    let webhookData;

    if (contentType === "application/json") {
      webhookData = JSON.parse(body);
    } else {
      res.writeHead(200);
      return res.end();
    }

    console.log("Inside addMessage. Webhook data: ", webhookData);
    console.log("Inside addMessage. Notebook id: ", notebookId);

    rsmq.sendMessage(
      {
        qname: QUEUENAME,
        message: JSON.stringify({ notebookId, webhookData }),
        delay: 0
      },
      err => {
        if (err) {
          console.error(err);
          return;
        }
      }
    );
    console.log("Pushed new webhookData message into queue");

    res.writeHead(200);
    res.end();
  });
};

module.exports.saveOrCloneNotebook = saveOrCloneNotebook;
module.exports.loadNotebook = loadNotebook;
module.exports.startNewSession = startNewSession;
module.exports.tearDown = tearDown;
module.exports.teardownZombieContainers = teardownZombieContainers;
module.exports.sendEmail = sendEmail;
module.exports.log = log;
module.exports.getSessionData = getSessionData;
module.exports.addMessage = addMessage;
module.exports.createQueue = createQueue;
