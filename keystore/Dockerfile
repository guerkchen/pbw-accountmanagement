FROM node:latest

WORKDIR /usr/src/app

# Install app dependencies
COPY package.json ./
RUN npm install

# Copy Src file
COPY keystore.js ./

CMD [ "node", "keystore.js" ]