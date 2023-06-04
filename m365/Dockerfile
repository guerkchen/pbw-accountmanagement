FROM node:latest

WORKDIR /usr/src/app

# Install app dependencies
COPY package.json ./
RUN npm install

# Copy Src file
COPY m365.js ./

CMD [ "node", "m365.js" ]