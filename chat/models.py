from django.db import models


class ChatRoom(models.Model):

    name = models.CharField(max_length=20)

    created = models.DateTimeField(auto_now_add=True)


class Message(models.Model):

    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE)

    user = models.CharField(max_length=20)

    content = models.TextField(max_length=2000)

    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ('created',)
