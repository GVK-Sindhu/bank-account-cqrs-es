FROM node:18-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE ${API_PORT}

CMD ["npm", "start"]
