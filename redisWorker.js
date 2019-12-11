require("dotenv").config();
const db = require("./db");

const RedisSMQ = require("rsmq");

// const QUEUENAME = "testqueue";
// const NAMESPACE = "rsmq";
// const REDIS_HOST = "127.0.0.1";
// const REDIS_PORT = "6379";

const QUEUENAME = process.env.QUEUENAME;
const NAMESPACE = process.env.NAMESPACE;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT;

const rsmq = new RedisSMQ({
  host: REDIS_HOST,
  port: REDIS_PORT,
  ns: NAMESPACE
});

const startRedisWorker = () => {
  // check for new messages on a delay
  console.log("Redis Worker started");

  setInterval(() => {
    console.log("Redis Worker checking for job");
    rsmq.receiveMessage({ qname: QUEUENAME }, (err, resp) => {
      if (err) {
        console.error(err);
        return;
      }
      if (resp.id) {
        console.log("Redis Worker processing webhook data");

        const { notebookId, webhookData } = JSON.parse(resp.message);
        console.log("Redis worker says notebook id is: ", notebookId);
        console.log("Redis worker says webhookData is: ", webhookData);

        db("WEBHOOK", null, notebookId, webhookData);

        rsmq.deleteMessage({ qname: QUEUENAME, id: resp.id }, err => {
          if (err) {
            console.error(err);
            return;
          }
          console.log("Redis Worker deleted message with id", resp.id);
        });
      } else {
        console.log("No messages currently in queue");
      }
    });
  }, 1000);
};

startRedisWorker();
