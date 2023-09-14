# Configuration file for jupyterhub.
# This is used in tests today, can also be used as is for testing puroposes
# python -m jupyterhub --config=build/jupyterhub_config.py

# import os
# import shlex
# import shutil
# from traitlets import default
# from traitlets import Unicode
# from subprocess import Popen
# from jupyterhub.spawner import LocalProcessSpawner
# from jupyterhub.utils import random_port

# On github actions, the following code fails with the error `OSError: [Errno 6] No such device or address`
# Usingnode.js on CI we can see the username is `runner`
# However the spawner fails, hence create a user on CI
username = 'runner' #os.getlogin()

c = get_config()  #noqa
c.JupyterHub.authenticator_class = 'jupyterhub.auth.DummyAuthenticator'
c.DummyAuthenticator.password = "pwd"
c.Spawner.args = ['--NotebookApp.allow_origin=*']
c.Authenticator.admin_users = set([username])

# Use for local testing
from jupyterhub.spawner import SimpleLocalProcessSpawner
c.JupyterHub.spawner_class = SimpleLocalProcessSpawner


# # This if for github actions
# class GitHubActionProcessSpawner(LocalProcessSpawner):
#     """
#     A version of LocalProcessSpawner that doesn't require users to exist on
#     the system beforehand.

#     Only use this for testing.

#     Note: DO NOT USE THIS FOR PRODUCTION USE CASES! It is very insecure, and
#     provides absolutely no isolation between different users!
#     """

#     home_dir = Unicode(help="The home directory for the user")

#     @default('home_dir')
#     def _default_home_dir(self):
#         return os.getcwd()

#     def make_preexec_fn(self, name):
#         def preexec():
#             pass

#         return preexec

#     def user_env(self, env):
#         env['USER'] = username
#         env['HOME'] = os.getcwd()
#         env['SHELL'] = '/bin/bash'
#         return env

#     def move_certs(self, paths):
#         """No-op for installing certs."""
#         return paths

#     async def start(self):
#         """Start the single-user server."""
#         print("Here__--_----__--_----__--_----")
#         print("Here__--_----__--_----__--_----")
#         print("Here__--_----__--_----__--_----")
#         print("Here__--_----__--_----__--_----")
#         self.log.warning("About to Start Process on CI")
#         if self.port == 0:
#             self.port = random_port()
#         cmd = []
#         env = self.get_env()

#         cmd.extend(self.cmd)
#         cmd.extend(self.get_args())

#         if self.shell_cmd:
#             # using shell_cmd (e.g. bash -c),
#             # add our cmd list as the last (single) argument:
#             cmd = self.shell_cmd + [' '.join(shlex.quote(s) for s in cmd)]

#         self.log.warning("Spawning %s", ' '.join(shlex.quote(s) for s in cmd))
#         print("Spawning %s", ' '.join(shlex.quote(s) for s in cmd))
#         popen_kwargs = dict(
#             preexec_fn=self.make_preexec_fn(self.user.name),
#             start_new_session=True,  # don't forward signals
#         )
#         popen_kwargs.update(self.popen_kwargs)
#         # don't let user config override env
#         popen_kwargs['env'] = env
#         try:
#             self.proc = Popen(cmd, **popen_kwargs)
#         except PermissionError:
#             # use which to get abspath
#             script = shutil.which(cmd[0]) or cmd[0]
#             self.log.error(
#                 "Permission denied trying to run %r. Does %s have access to this file?",
#                 script,
#                 self.user.name,
#             )
#             raise

#         self.pid = self.proc.pid

#         return (self.ip or '127.0.0.1', self.port)

# c.JupyterHub.spawner_class = GitHubActionProcessSpawner

# More bogus users
c.Authenticator.allowed_users = {'joe', 'bloe'}
# Map the bogus users to a real user, so that we can spawn the jupyter servers.
c.Authenticator.username_map = {'joe': username, 'bloe': username}
# c.JupyterHub.bind_url = 'http://localhost:8091'
# c.JupyterHub.hub_connect_url = 'http://localhost:8092'
origin = '*'
c.JupyterHub.tornado_settings = {
    'headers': {
      'Access-Control-Allow-Origin': origin,
   },
}
c.NotebookApp.allow_origin = '*'
c.ServerApp.allow_origin = '*'
c.Spawner.args = ['--ServerApp.allow_remote_accessBool=True','--ServerApp.disable_check_xsrfBool=True','--ServerApp.allow_origin={0}'.format(origin), '--ServerApp.allow_origin_pat=.*']
