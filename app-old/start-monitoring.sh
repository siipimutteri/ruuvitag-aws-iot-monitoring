npx ts-node main \
  --privateKey=../keys/RaspberryPi.private.key \
  --clientCert=../keys/RaspberryPi.cert.pem \
  --caCert=../keys/AmazonRootCA1.pem \
  --host-name=1234567890abcd-ats.iot.region.amazonaws.com \
  --clientId=RaspberryPi
