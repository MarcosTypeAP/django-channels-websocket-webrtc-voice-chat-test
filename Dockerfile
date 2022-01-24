FROM python:3.9.9-alpine

RUN apk update \
	&& apk add --no-cache --virtual build-deps gcc python3-dev musl-dev \
	mariadb-dev build-base libffi-dev \
	&& apk add --no-cache jpeg-dev zlib-dev libjpeg \
	&& apk add --no-cache python3 py3-pip py-cffi \
	&& apk add --no-cache postgresql-dev redis

COPY ./requirements /app/requirements

WORKDIR /app

RUN python3 -m pip install --upgrade pip \
	&& python3 -m pip install --no-cache-dir -r requirements/production.txt \
	&& apk del build-deps

COPY . /app/

ENV PYTHONUNBUFFERED 1

RUN chmod +x /app/start

CMD ["/app/start"]
