'use strict';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const APP_URL = process.env.APP_URL;

//https://www.facebook.com/messages/t/102578394918324
// appid = 1437772286611018

// Imports dependencies and set up http server
const 
  { uuid } = require('uuidv4'),
  {format} = require('util'),
  request = require('request'),
  express = require('express'),
  body_parser = require('body-parser'),
  firebase = require("firebase-admin"),
  ejs = require("ejs"),  
  fs = require('fs'),
  multer  = require('multer'),  
  app = express(); 

const uuidv4 = uuid();
const session = require('express-session');

app.use(body_parser.json());
app.use(body_parser.urlencoded());
app.set('trust proxy', 1);
app.use(session({secret: 'effystonem'}));

const bot_questions = {
  "q1": "please enter you name",
  "q2": "please enter your phone number",
  "q3": "please enter your address",
  "q4": "please enter your order reference number" 
}

let sess;

let current_question = '';
let user_id = ''; 
let userInputs = [];
let first_reg = false;
let customer = [];




let temp_points = 0;
let cart_total = 0;
let cart_discount = 0;

/*
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
})*/

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits :{
    fileSize: 50 * 1024 * 1024  //no larger than 5mb
  }

});

// parse application/x-www-form-urlencoded


app.set('view engine', 'ejs');
app.set('views', __dirname+'/views');


var firebaseConfig = {
     credential: firebase.credential.cert({
    "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    "client_email": process.env.FIREBASE_CLIENT_EMAIL,
    "project_id": process.env.FIREBASE_PROJECT_ID,    
    }),
    databaseURL: process.env.FIREBASE_DB_URL,   
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  };



firebase.initializeApp(firebaseConfig);

let db = firebase.firestore(); 
let bucket = firebase.storage().bucket();

// Sets server port and logs message on success
app.listen(process.env.PORT || 1337, () => console.log('webhook is listening'));

// Accepts POST requests at /webhook endpoint
app.post('/webhook', (req, res) => {  

  
   
  // Parse the request body from the POST
  let body = req.body;  
  sess = req.session;

  // Check the webhook event is from a Page subscription
  if (body.object === 'page') {
    body.entry.forEach(function(entry) {

      let webhook_event = entry.messaging[0];
      let sender_psid = webhook_event.sender.id;       
      
      user_id = sender_psid; 

      
      sess.uid = sender_psid;
     
      

      if(!userInputs[user_id]){
        userInputs[user_id] = {};
        customer[user_id] = {};
      } 
               

      if (webhook_event.message) {
      

        if(webhook_event.message.quick_reply){
            handleQuickReply(sender_psid, webhook_event.message.quick_reply.payload);
          }else{
            handleMessage(sender_psid, webhook_event.message);                       
          }                
      } else if (webhook_event.postback) {        
        handlePostback(sender_psid, webhook_event.postback);
      }
      
    });
    // Return a '200 OK' response to all events
    res.status(200).send('EVENT_RECEIVED');

  } else {
    // Return a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }

});


app.use('/uploads', express.static('uploads'));


app.get('/',function(req,res){    
    res.send('your app is up and running');
});



app.get('/login',function(req,res){    
    sess = req.session;

    if(sess.login){
       res.send('You are already login. <a href="logout">logout</a>');
    }else{
      res.render('login.ejs');
    } 
    
});


app.get('/logout',function(req,res){ 
    //sess = req.session;   
    req.session.destroy(null);  
    res.redirect('login');
});

app.post('/login',function(req,res){    
    sess = req.session;

    let username = req.body.username;
    let password = req.body.password;

    if(username == 'admin' && password == 'test123'){
      sess.username = 'admin';
      sess.login = true;
      res.send('login successful');
    }else{
      res.send('login failed');
    }   
});

app.get('/publicpage',function(req,res){    
    res.render('publicpage.ejs');
});


app.get('/privatepage',function(req,res){ 
    sess = req.session;
    console.log('SESS:', sess); 
    if(sess.login){
       res.render('privatepage.ejs');
    }else{
      res.send('you are not authorized to view this page');
    }   
});

//secondhandshop routes

//sell phone form
app.get('/sellphone',function(req,res){ 
    res.render('phone/sellphone.ejs', {uid:user_id});
});

//save data 
app.post('/sellphone',upload.single('image'),function(req,res){   
    let title = req.body.title;
    let price = parseInt(req.body.price);
    let description = req.body.description;
    let seller_name = req.body.seller_name;
    let seller_phone = req.body.seller_phone;
    let created_on = new Date();
    let fbid = req.body.uid;

    let file = req.file;
    if (file) {
      uploadImageToStorage(file).then((img_url) => {
          db.collection('phones').add({
            fbid: fbid,
            title: title,
            price: price,
            description: description,          
            seller_name: seller_name,
            seller_phone: seller_phone,
            image: img_url,
            created_on: created_on
            }).then(success => {   
              console.log("DATA SAVED")
              let text = "Thank you. You have added a post";      
              let response = {"text": text};
              callSend(user_id, response);     
            }).catch(error => {
              console.log(error);
            }); 
      }).catch((error) => {
        console.error(error);
      });
    }      
});


app.get('/myphones', async(req,res)=>{    
  const phonesRef = db.collection('phones').where("fbid", "==", user_id);
  const snapshot = await phonesRef.get();

  if (snapshot.empty) {
    res.send('no data');
  }else{
      let data = []; 

      snapshot.forEach(doc => { 
        
        let product = {}; 
        product = doc.data();        
        product.id = doc.id;         
        let d = new Date(doc.data().created_on._seconds);
        d = d.toString();
        product.created_on = d;
        data.push(product);        
      });
   
      res.render('phone/myphones.ejs', {data:data, uid:user_id});

  }
});

app.get('/buyphone', async(req,res)=>{    
    const phonesRef = db.collection('phones').orderBy('created_on', 'desc');
  const snapshot = await phonesRef.get();

  if (snapshot.empty) {
    res.send('no data');
  }else{
      let data = []; 

      snapshot.forEach(doc => { 
        
        let product = {}; 
        product = doc.data();        
        product.id = doc.id;         
        let d = new Date(doc.data().created_on._seconds);
        d = d.toString();
        product.created_on = d;
        data.push(product);        
      });
   
      res.render('phone/buyphones.ejs', {data:data, uid:user_id});

  }
});

//remove listng
app.post('/delete',async(req,res)=>{    
    let pid = req.body.pid;

    const delProduct = await db.collection('phones').doc(pid).delete();
    let text = "Thank you. You have deleted a post";      
    let response = {"text": text};
    callSend(user_id, response); 
});

// register shop
app.get('/shop_register',function(req,res){ 
    res.render('phone/shop_register.ejs', {uid:user_id});
});


app.post('/shop_register', async(req,res)=>{ 

    let data = {
      name:req.body.name,
      address:req.body.address,
      fbid: req.body.uid
    }

    const addShop = await db.collection('shops').add(data);

    
    if(addShop){
      let text = "Thank you. You have registered your shop";      
      let response = {"text": text};
      callSend(user_id, response);
    }else{
      console.log('reg error');
    }

   

    
    
});


//end secondhandshop routes






//webview test
app.get('/webview/:sender_id',function(req,res){
    const sender_id = req.params.sender_id;
    res.render('webview.ejs',{title:"Hello!! from WebView", sender_id:sender_id});
});



app.post('/webview',upload.single('file'),function(req,res){
      
      let name  = req.body.name;
      let email = req.body.email;
      let img_url = "";
      let sender = req.body.sender; 

      let file = req.file;
      if (file) {
        uploadImageToStorage(file).then((img_url) => {
            db.collection('webview').add({
              name: name,
              email: email,
              image: img_url
              }).then(success => {   
                console.log("DATA SAVED")
                thankyouReply(sender, name, img_url);    
              }).catch(error => {
                console.log(error);
              }); 
        }).catch((error) => {
          console.error(error);
        });
      } 
      
           
});

//Set up Get Started Button. To run one time
//eg https://fbstarter.herokuapp.com/setgsbutton
app.get('/setgsbutton',function(req,res){
    setupGetStartedButton(res);    
});

//Set up Persistent Menu. To run one time
//eg https://fbstarter.herokuapp.com/setpersistentmenu
app.get('/setpersistentmenu',function(req,res){
    setupPersistentMenu(res);    
});

//Remove Get Started and Persistent Menu. To run one time
//eg https://fbstarter.herokuapp.com/clear
app.get('/clear',function(req,res){    
    removePersistentMenu(res);
});

//whitelist domains
//eg https://fbstarter.herokuapp.com/whitelists
app.get('/whitelists',function(req,res){    
    whitelistDomains(res);
});


// Accepts GET requests at the /webhook endpoint
app.get('/webhook', (req, res) => {  

  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;  

  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];  
    
  // Check token and mode
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);    
    } else {      
      res.sendStatus(403);      
    }
  }
});

/**********************************************
Function to Handle when user send quick reply message
***********************************************/

function handleQuickReply(sender_psid, received_message) {

  console.log('QUICK REPLY', received_message);

  received_message = received_message.toLowerCase();  

  switch(received_message) {                
      case "member":          
          memberActions(sender_psid);
        break;
      case "shop":          
          shopActions(sender_psid);
        break;                
      default:
          defaultReply(sender_psid);
  } 
}

/**********************************************
Function to Handle when user send text message
***********************************************/

const handleMessage = (sender_psid, received_message) => {

  console.log('TEXT REPLY', received_message);
 
  let response;

  if(received_message.attachments){
     handleAttachments(sender_psid, received_message.attachments);
  }else if(current_question == 'q1'){     
     userInputs[user_id].name = received_message.text;
     current_question = 'q2';
     botQuestions(current_question, sender_psid);
  }else {
      
      let user_message = received_message.text;      
     
      user_message = user_message.toLowerCase(); 

      switch(user_message) { 

      
      case "start":{
          startGreeting(sender_psid);
        break;
      }              
      case "text":
        textReply(sender_psid);
        break;      
      case "button":                  
        buttonReply(sender_psid);
        break;
      case "webview":
        webviewTest(sender_psid);
        break;      
                    
      default:
          defaultReply(sender_psid);
      }       
          
      
    }

}

/*********************************************
Function to handle when user send attachment
**********************************************/


const handleAttachments = (sender_psid, attachments) => {
  
  console.log('ATTACHMENT', attachments);


  let response; 
  let attachment_url = attachments[0].payload.url;
    response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Is this the right picture?",
            "subtitle": "Tap a button to answer.",
            "image_url": attachment_url,
            "buttons": [
              {
                "type": "postback",
                "title": "Yes!",
                "payload": "yes-attachment",
              },
              {
                "type": "postback",
                "title": "No!",
                "payload": "no-attachment",
              }
            ],
          }]
        }
      }
    }
    callSend(sender_psid, response);
}


/*********************************************
Function to handle when user click button
**********************************************/
const handlePostback = (sender_psid, received_postback) => {  

  let payload = received_postback.payload;

  console.log('BUTTON PAYLOAD', payload);

  
  if(payload.startsWith("Doctor:")){
    let doctor_name = payload.slice(7);
    console.log('SELECTED DOCTOR IS: ', doctor_name);
    userInputs[user_id].doctor = doctor_name;
    console.log('TEST', userInputs);
    firstOrFollowUp(sender_psid);
  }else{

      switch(payload) {        
      case "yes":
          showButtonReplyYes(sender_psid);
        break;
      case "no":
          showButtonReplyNo(sender_psid);
        break; 


      default:
          defaultReply(sender_psid);
    } 

  }


  
}


const generateRandom = (length) => {
   var result           = '';
   var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
   var charactersLength = characters.length;
   for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
   }
   return result;
}




function webviewTest(sender_psid){
  let response;
  response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Click to open webview?",                       
            "buttons": [              
              {
                "type": "web_url",
                "title": "webview",
                "url":APP_URL+"webview/"+sender_psid,
                 "webview_height_ratio": "full",
                "messenger_extensions": true,          
              },
              
            ],
          }]
        }
      }
    }
  callSendAPI(sender_psid, response);
}




/**************
startsecondhandshop
**************/

const startGreeting =(sender_psid) => {
  let response = {"text": "Welcome to secondhand shop"};
  let response2 = {
    "text": "Select your activitiy",
    "quick_replies":[
            {
              "content_type":"text",
              "title":"Member",
              "payload":"member",              
            },{
              "content_type":"text",
              "title":"Shop",
              "payload":"shop",             
            }
    ]
  }
  callSend(sender_psid, response).then(()=>{
    return callSend(sender_psid, response2);
  });
}

const memberActions = (sender_psid) =>{
  let  response = {
        "attachment": {
          "type": "template",
          "payload": {
            "template_type": "generic",
            "elements": [
            {
              "title": "Sell Phone",                       
              "buttons": [              
                {
                  "type": "web_url",
                  "title": "sell phone",
                  "url":APP_URL+"sellphone/",
                   "webview_height_ratio": "full",
                  "messenger_extensions": true,          
                },
                
              ],
            },
            {
              "title": "My Phones",                       
              "buttons": [              
                {
                  "type": "web_url",
                  "title": "my phones",
                  "url":APP_URL+"myphones/",
                   "webview_height_ratio": "full",
                  "messenger_extensions": true,          
                },
                
              ],
            },
            {
              "title": "Buy Phone",                       
              "buttons": [              
                {
                  "type": "web_url",
                  "title": "buy phone",
                  "url":APP_URL+"buyphone/",
                   "webview_height_ratio": "full",
                  "messenger_extensions": true,          
                },
                
              ],
            }


            ]
          }
        }
      }
    callSendAPI(sender_psid, response);
}



const shopActions = async(sender_psid) =>{

    const shopsRef = db.collection('shops').where("fbid", "==", user_id).limit(1);
    const snapshot = await shopsRef.get();


    if (snapshot.empty) {
      //no shop registerd with the fbid 
      let response = {
            "attachment": {
              "type": "template",
              "payload": {
                "template_type": "generic",
                "elements": [{
                  "title": "Register Your Shop",                  
                  "buttons": [              
                    {
                      "type": "web_url",
                      "title": "Register",
                      "url":APP_URL+"shop_register/",
                       "webview_height_ratio": "full",
                      "messenger_extensions": true,          
                    },
                    
                  ],
                }]
              }
            }
          }  
        callSend(sender_psid, response);      
    }else{
      // shop already registerd with the fbid  

      let response = {
            "attachment": {
              "type": "template",
              "payload": {
                "template_type": "generic",
                "elements": [
                {
                  "title": "Sell New Phone",                  
                  "buttons": [              
                    {
                      "type": "web_url",
                      "title": "sell phone",
                      "url":APP_URL+"shop_sell/",
                       "webview_height_ratio": "full",
                      "messenger_extensions": true,          
                    },
                    
                  ],
                },
                {
                  "title": "View Orders",                  
                  "buttons": [              
                    {
                      "type": "web_url",
                      "title": "sell phone",
                      "url":APP_URL+"shop_orders/",
                       "webview_height_ratio": "full",
                      "messenger_extensions": true,          
                    },
                    
                  ],
                },
                {
                  "title": "View Orders",                  
                  "buttons": [              
                    {
                      "type": "web_url",
                      "title": "sell phone",
                      "url":APP_URL+"shop_phoneslist/",
                       "webview_height_ratio": "full",
                      "messenger_extensions": true,          
                    },
                    
                  ],
                }

                ]
              }
            }
          }  
        callSend(sender_psid, response); 

    }
  
}


/**************
endsecondhandshop
**************/

const textReply =(sender_psid) => {
  let response = {"text": "You sent text message"};
  callSend(sender_psid, response);
}


const buttonReply =(sender_psid) => {

  let response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Are you OK?",
            "image_url":"https://www.mindrops.com/images/nodejs-image.png",                       
            "buttons": [
                {
                  "type": "postback",
                  "title": "Yes!",
                  "payload": "yes",
                },
                {
                  "type": "postback",
                  "title": "No!",
                  "payload": "no",
                }
              ],
          }]
        }
      }
    }

  
  callSend(sender_psid, response);
}

const showButtonReplyYes =(sender_psid) => {
  let response = { "text": "You clicked YES" };
  callSend(sender_psid, response);
}

const showButtonReplyNo =(sender_psid) => {
  let response = { "text": "You clicked NO" };
  callSend(sender_psid, response);
}

const thankyouReply =(sender_psid, name, img_url) => {
  let response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Thank you! " + name,
            "image_url":img_url,                       
            "buttons": [
                {
                  "type": "postback",
                  "title": "Yes!",
                  "payload": "yes",
                },
                {
                  "type": "postback",
                  "title": "No!",
                  "payload": "no",
                }
              ],
          }]
        }
      }
    }
  callSend(sender_psid, response);
}


const defaultReply = (sender_psid) => {
  let response1 = {"text": "#253b80 text reply, type 'text'"};
  let response2 = {"text": "To test quick reply, type 'quick'"};
  let response3 = {"text": "To test button reply, type 'button'"};   
  let response4 = {"text": "To test webview, type 'webview'"};
    callSend(sender_psid, response1).then(()=>{
      return callSend(sender_psid, response2).then(()=>{
        return callSend(sender_psid, response3).then(()=>{
          return callSend(sender_psid, response4);
        });
      });
  });  
}

const callSendAPI = (sender_psid, response) => {   
  let request_body = {
    "recipient": {
      "id": sender_psid
    },
    "message": response
  }
  
  return new Promise(resolve => {
    request({
      "uri": "https://graph.facebook.com/v6.0/me/messages",
      "qs": { "access_token": PAGE_ACCESS_TOKEN },
      "method": "POST",
      "json": request_body
    }, (err, res, body) => {
      if (!err) {
        //console.log('RES', res);
        //console.log('BODY', body);
        resolve('message sent!')
      } else {
        console.error("Unable to send message:" + err);
      }
    }); 
  });
}

async function callSend(sender_psid, response){
  let send = await callSendAPI(sender_psid, response);
  return 1;
}


const uploadImageToStorage = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject('No image file');
    }
    let newFileName = `${Date.now()}_${file.originalname}`;

    let fileUpload = bucket.file(newFileName);

    const blobStream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
         metadata: {
            firebaseStorageDownloadTokens: uuidv4
          }
      }
    });

    blobStream.on('error', (error) => {
      console.log('BLOB:', error);
      reject('Something is wrong! Unable to upload at the moment.');
    });

    blobStream.on('finish', () => {
      // The public URL can be used to directly access the file via HTTP.
      //const url = format(`https://storage.googleapis.com/${bucket.name}/${fileUpload.name}`);
      const url = format(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${fileUpload.name}?alt=media&token=${uuidv4}`);
      console.log("image url:", url);
      resolve(url);
    });

    blobStream.end(file.buffer);
  });
}




/*************************************
FUNCTION TO SET UP GET STARTED BUTTON
**************************************/

const setupGetStartedButton = (res) => {
  let messageData = {"get_started":{"payload":"get_started"}};

  request({
      url: 'https://graph.facebook.com/v2.6/me/messenger_profile?access_token='+ PAGE_ACCESS_TOKEN,
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      form: messageData
    },
    function (error, response, body) {
      if (!error && response.statusCode == 200) {        
        res.send(body);
      } else { 
        // TODO: Handle errors
        res.send(body);
      }
  });
} 

/**********************************
FUNCTION TO SET UP PERSISTENT MENU
***********************************/



const setupPersistentMenu = (res) => {
  var messageData = { 
      "persistent_menu":[
          {
            "locale":"default",
            "composer_input_disabled":false,
            "call_to_actions":[
                {
                  "type":"postback",
                  "title":"View My Tasks",
                  "payload":"view-tasks"
                },
                {
                  "type":"postback",
                  "title":"Add New Task",
                  "payload":"add-task"
                },
                {
                  "type":"postback",
                  "title":"Cancel",
                  "payload":"cancel"
                }
          ]
      },
      {
        "locale":"default",
        "composer_input_disabled":false
      }
    ]          
  };
        
  request({
      url: 'https://graph.facebook.com/v2.6/me/messenger_profile?access_token='+ PAGE_ACCESS_TOKEN,
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      form: messageData
  },
  function (error, response, body) {
      if (!error && response.statusCode == 200) {
          res.send(body);
      } else { 
          res.send(body);
      }
  });
} 

/***********************
FUNCTION TO REMOVE MENU
************************/

const removePersistentMenu = (res) => {
  var messageData = {
          "fields": [
             "persistent_menu" ,
             "get_started"                 
          ]               
  };  
  request({
      url: 'https://graph.facebook.com/v2.6/me/messenger_profile?access_token='+ PAGE_ACCESS_TOKEN,
      method: 'DELETE',
      headers: {'Content-Type': 'application/json'},
      form: messageData
  },
  function (error, response, body) {
      if (!error && response.statusCode == 200) {          
          res.send(body);
      } else {           
          res.send(body);
      }
  });
} 


/***********************************
FUNCTION TO ADD WHITELIST DOMAIN
************************************/

const whitelistDomains = (res) => {
  var messageData = {
          "whitelisted_domains": [
             APP_URL , 
             "https://herokuapp.com" ,                                   
          ]               
  };  
  request({
      url: 'https://graph.facebook.com/v2.6/me/messenger_profile?access_token='+ PAGE_ACCESS_TOKEN,
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      form: messageData
  },
  function (error, response, body) {
      if (!error && response.statusCode == 200) {          
          res.send(body);
      } else {           
          res.send(body);
      }
  });
} 