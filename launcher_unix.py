import os
import platform
import subprocess
from tkinter import *
from tkinter.ttk import *

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def LaunchApp():
  path = T.get().strip()
  if not path:
    return
  if platform.system() == 'Darwin':
    subprocess.Popen(['open', path])
  else:
    subprocess.Popen([path])


window = Tk()
window.title('Game Laucher menu')
window.configure(bg='lightgray')
window.geometry('800x400')
p1 = PhotoImage(file = os.path.join(BASE_DIR, 'pictures', 'inkling.png'))
window.iconphoto(False, p1)
b = Button(window, text = 'Launch app', command=LaunchApp)
b.pack(side = BOTTOM, pady=5)
T = Entry(window, width='50')
T.pack(side=TOP)

l = Label(window, text='Insert New application exe / path')
l.pack(pady=5)
window.mainloop()
