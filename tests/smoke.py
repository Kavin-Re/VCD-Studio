import sys, os
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out=os.path.join(ROOT,'out'); os.makedirs(out,exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1400,'height':850})
    logs=[]
    pg.on('console',lambda m:logs.append(m.type+': '+m.text)); pg.on('pageerror',lambda e:logs.append('PAGEERR '+str(e)))
    pg.goto('file://'+ROOT+'/index.html'); pg.wait_for_timeout(1200)
    pg.screenshot(path=out+'/smoke.png')
    print('\n'.join(logs))
    b.close()
