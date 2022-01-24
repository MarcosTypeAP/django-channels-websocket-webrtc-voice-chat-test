from django.shortcuts import render
from chat.models import ChatRoom


def index(request):
    return render(request, 'chat/index.html')


def room(request, username, room_name):
    room, _ = ChatRoom.objects.get_or_create(name=room_name)

    messages = room.message_set.all().values('content', 'user')

    return render(request, 'chat/room.html', {
        'room_context': {
            'room_name': room_name,
            'username': username,
        },
        'messages': messages,
    })
