FROM node:latest

WORKDIR /usr/src/app

# Install app dependencies
COPY package.json ./
RUN npm install

# Copy Src file
COPY webservice.js ./

CMD [ "node", "webservice.js" ]