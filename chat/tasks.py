from __future__ import absolute_import

from djangoChannelsTest.celery import app
from chat.models import Message


@app.task(name='chat.create_message')
def create_message(room_id, username, content):
    Message.objects.create(room_id=room_id, user=username, content=content)
