# watch pricing and send alert

### requirement
> nodejs 7.x (axios、request、ripple-lib、bignumber.js、forever)
> python 3.6 （itchat）

### Implemention
'''
  forever(nodejs) watchETH.js (get the ETH prices difference between gatehub and yunbi)
  forever(nodejs) watchXRP.js (get the XRP prices difference between gatehub and btsd)
  python alert.py (if prices difference exceed the threshold value, send message to wechat)
'''
