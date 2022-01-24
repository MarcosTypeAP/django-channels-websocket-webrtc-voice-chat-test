import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from chat.models import ChatRoom
from chat.tasks import create_message


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.username = self.scope['url_route']['kwargs']['username']
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = 'chat_%s' % self.room_name
        self.room = await self.get_room()

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.channel_layer.group_add(
            self.username,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        await self.channel_layer.group_discard(
            self.username,
            self.channel_name
        )

    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        event_type = text_data_json['type']
        if event_type == 'ping':
            await self.send('{"type":"pong"}')

        elif event_type == 'ice_candidate':
            await self.handle_ice_candidate(text_data_json)

        elif event_type == 'message':
            await self.handle_received_message(text_data_json)

        elif event_type == 'offer':
            await self.handle_received_offer(text_data_json)

        elif event_type == 'answer':
            await self.handle_received_answer(text_data_json)

        elif event_type == 'retry_connection':
            await self.handle_retry_connection(text_data_json)

    async def handle_retry_connection(self, data):
        text_data = json.dumps({
            'type': 'retry_connection',
            'user': self.username
        })
        await self.send_text_data_to_group(data['user'], text_data)

    async def handle_received_message(self, data):
        message = data['message']
        create_message.delay(
            room_id=self.room.pk, username=self.username, content=message
        )
        text_data = json.dumps({
            'type': 'message',
            'message': message,
            'user': self.username
        })
        await self.send_text_data_to_group(self.room_group_name, text_data)

    async def handle_received_offer(self, data):
        text_data = json.dumps({
            'type': 'offer_connection',
            'user': self.username,
            'offer': data['offer']
        })
        await self.send_text_data_to_group(data['user'], text_data)

    async def handle_received_answer(self, data):
        text_data = json.dumps({
            'type': 'answer_connection',
            'user': self.username,
            'answer': data['answer']
        })
        await self.send_text_data_to_group(data['user'], text_data)

    async def handle_ice_candidate(self, data):
        text_data = json.dumps({
            'type': 'remote_ice_candidate',
            'user': self.username,
            'candidate': data['candidate']
        })
        await self.send_text_data_to_group(data['user'], text_data)

    async def send_text_data_to_group(self, group_name, text_data):
        await self.channel_layer.group_send(
            group_name,
            {
                'type': 'send.text.data',
                'text_data': text_data
            }
        )

    async def send_text_data(self, event):
        await self.send(text_data=event['text_data'])

    @database_sync_to_async
    def get_room(self):
        return ChatRoom.objects.get(name=self.room_name)
