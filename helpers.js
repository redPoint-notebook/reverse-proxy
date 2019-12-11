require("dotenv").config();
const db = require("./db");
const fs = require("fs");
const uuidv4 = require("uuid/v4");
const Docker = require("dockerode");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const nodemailer = require("nodemailer");
const redis = require("redis");
const redisClient = redis.createClient();

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
  const notebookId = sessions[req.headers.host].notebookId;
  if (notebookId) {
    db("LOAD", null, notebookId).then(data => {
      log(`Loaded notebook : ${data}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.end(JSON.stringify(data));
    });
  } else {
    res.end(JSON.stringify(null));
  }
};

const tearDown = (req, res, sessions) => {
  console.log("INSIDE TEARDOWN");
  const session = sessions[req.headers.host];
  const lastVisit = session.lastVisited;
  const containerId = session.containerId;
  setTimeout(() => {
    if (lastVisit === session.lastVisited) {
      log("DELETING SESSION AND CONTAINER", `sessions: ${sessions}`);
      docker.getContainer(containerId).remove({ force: true });
      delete sessions[req.headers.host];
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
        sessions[sessionURL] = {
          // www.asd443.redpoint.com
          ip: containerURL, // http://172.11.78:8000
          containerId,
          notebookId: notebookId || null,
          lastVisited: Date.now()
        };

        console.log("Sessions object: " + JSON.stringify(sessions));
      });
    });
  });
};

const teardownZombieContainers = sessions => {
  setInterval(() => {
    docker.listContainers((err, containers) => {
      const sessionContainerIds = Object.keys(sessions).map(sessionUrl => {
        return sessions[sessionUrl].containerId;
      });
      containers.forEach(containerInfo => {
        if (!sessionContainerIds.includes(containerInfo.Id)) {
          docker.getContainer(containerInfo.Id).remove({ force: true });
        }
      });
    });
  }, 15000);
};

const enqueueWebhookData = (req, res) => {
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
    // place webhookData in queue here?
    redisClient.rpush(
      "webhookqueue",
      JSON.stringify({ [notebookId]: webhookData })
    ); // { [notebookId]: body } ?

    // console.log(webhookData);
  });
};

// const processWebhookData = () => {
//   const intId = setInterval(() => {
//     // if anything in queue, process it using BLPOP - blocking list left pop
//     redisClient.blpop("webhookqueue", 0, (err, msg) => {
//       if (!msg) {
//         clearInterval(intId);
//         redisClient.quit();
//       }
//       let data = JSON.parse(msg[1]);
//       let notebookId = Object.keys(data)[0];
//       let webhookData = data[notebookId];

//       console.log("webhookqueue msg : ", msg);

//       db("WEBHOOK", null, notebookId, webhookData);
//     });
//   }, 100);
// };

// const saveWebhook = (req, res) => {
//   const matchData = req.url.match(/\/webhooks\/(.*)/);
//   let notebookId;
//   let body = "";

//   if (matchData) {
//     notebookId = matchData[1];
//   }

//   console.log("Webhook notebook id is :", notebookId);

//   req.on("data", chunk => {
//     body += chunk;
//   });

// req.on("end", () => {
//   const webhookData = JSON.parse(body);
//   // place webhookData in queue here?
//   // client.rpush("webhookqueue", JSON.stringify( {`notebook:${notebookId}`body)});

//   // https://redis.io/commands/blpop
//   // client.blpop()
//   console.log(webhookData);

//   db("WEBHOOK", null, notebookId, webhookData);
//   res.writeHead(200);
//   res.end();
// });
// };

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
// module.exports.saveWebhook = saveWebhook;
module.exports.enqueueWebhookData = enqueueWebhookData;
// module.exports.processWebhookData = processWebhookData;
module.exports.sendEmail = sendEmail;
module.exports.log = log;
