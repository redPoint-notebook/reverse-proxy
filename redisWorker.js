require("dotenv").config();
const db = require("./db");
const RedisSMQ = require("rsmq");
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
  console.log("Redis Worker started");

  setInterval(() => {
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

        db("WEBHOOK", null, notebookId, webhookData)
          .then(data => {
            rsmq.deleteMessage({ qname: QUEUENAME, id: resp.id }, err => {
              if (err) {
                console.error(err);
                return;
              }
              console.log("Redis Worker deleted message with id", resp.id);
            });
          })
          .catch(err => {
            console.log(err);
          });
      } else {
      }
    });
  }, 100);
};

startRedisWorker();
