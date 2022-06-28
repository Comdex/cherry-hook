#!/bin/bash

pm2 stop cherry_hook
pm2 start cherryhook.js --name cherry_hook
