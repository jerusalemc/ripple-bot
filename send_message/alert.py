import itchat
import time
from itchat.content import *


itchat.auto_login(True)
chatrooms = itchat.get_chatrooms()
man = ''
for chatroom in chatrooms:
    if chatroom['NickName'] == '男人的买币':
        man = chatroom['UserName']
        break

while(True):
    with open('result.txt') as f:
        a = f.readlines()
    with open('result1.txt') as f:
        b = f.readlines()
    if a[0] != b[0]:
        itchat.send(a[0], man)
        with open('result1.txt','w') as f:
            f.writelines(a[0])       
        print('***')

    with open('result_xrp.txt') as f:
        c = f.readlines()
    with open('result_xrp1.txt') as f:
        d = f.readlines()
    if c[0] != d[0]:
        itchat.send(c[0], man)
        with open('result_xrp1.txt', 'w') as f:
            f.writelines(c[0])
        print('@@@')
    time.sleep(2)
