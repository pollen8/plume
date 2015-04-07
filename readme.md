Create Virtual machine / vagrant
=================================
https://confluence.jetbrains.com/display/PhpStorm/Getting+started+with+Vagrant+in+PhpStorm
http://www.dev-metal.com/setup-professional-local-server-virtual-machine-vagrant-phpstorm/

Set up server
=============
turn off nginx send file:
> sudo vi /etd/nginx/nginx.conf

https://abitwiser.wordpress.com/2011/02/24/virtualbox-hates-sendfile/

web root @cd /usr/share/nginx/html
cd 

if you get issues with npm erroring on symlinks do:

npm install foo --no-bin-links

// 