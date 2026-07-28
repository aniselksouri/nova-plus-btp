FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=4173
ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 4173

CMD ["npm", "start"]
