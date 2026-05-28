const http = require('http');
const fs = require('fs');
const path = require('path');

// Create a dummy 1x1 PNG pixel buffer to simulate an uploaded image
const dummyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const boundary = '----TestBoundary' + Math.random().toString(36).substring(2);

const postData = Buffer.concat([
  Buffer.from(`--${boundary}\r\n`),
  Buffer.from('Content-Disposition: form-data; name="image"; filename="test.png"\r\n'),
  Buffer.from('Content-Type: image/png\r\n\r\n'),
  dummyPng,
  Buffer.from(`\r\n--${boundary}--\r\n`)
]);

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/products/upload-image',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer admin-secret-session-token-12345',
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': postData.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response Body:', body);
    process.exit(res.statusCode === 200 ? 0 : 1);
  });
});

req.on('error', (err) => {
  console.error('Request Error:', err.message);
  process.exit(1);
});

req.write(postData);
req.end();
