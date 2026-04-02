// Import Dependencies
import { PhoneIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { EnvelopeIcon, UserIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useState, useEffect } from "react";
import { HiPencil } from "react-icons/hi";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as Yup from 'yup';
import { toast } from "sonner";

// Local Imports
import { PreviewImg } from "@/components/shared/PreviewImg";
import { Avatar, Button, Input, Upload } from "@/components/ui";
import { useAuthContext } from "@/app/contexts/auth/context";
import { AdminUserService, UpdatePasswordData } from "@/utils/adminUserService";

// ----------------------------------------------------------------------

interface ProfileFormData {
  name: string;
  email: string;
}

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const profileSchema = Yup.object().shape({
  name: Yup.string().required('Name is required'),
  email: Yup.string().email('Invalid email').required('Email is required'),
});

const passwordSchema = Yup.object().shape({
  currentPassword: Yup.string().required('Current password is required'),
  newPassword: Yup.string().min(6, 'Password must be at least 6 characters').required('New password is required'),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref('newPassword')], 'Passwords must match')
    .required('Confirm password is required'),
});

export default function General() {
  const [avatar, setAvatar] = useState<File | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isLoadingPassword, setIsLoadingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const { user } = useAuthContext();

  const profileForm = useForm<ProfileFormData>({
    resolver: yupResolver(profileSchema),
    defaultValues: {
      name: '',
      email: '',
    },
  });

  const passwordForm = useForm<PasswordFormData>({
    resolver: yupResolver(passwordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  useEffect(() => {
    if (user) {
      profileForm.setValue('name', user.name || '');
      profileForm.setValue('email', user.email || '');
    }
  }, [user, profileForm]);

  const onSubmitProfile = async (data: ProfileFormData) => {
    if (!user?.id) return;

    setIsLoadingProfile(true);
    try {
      const { success, error } = await AdminUserService.updateUser(user.id, {
        name: data.name,
        email: data.email,
      });

      if (success) {
        toast.success('Profile updated successfully');
      } else {
        toast.error(error || 'Failed to update profile');
      }
    } catch (error) {
      toast.error('An error occurred while updating profile');
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const onSubmitPassword = async (data: PasswordFormData) => {
    if (!user?.id) return;

    setIsLoadingPassword(true);
    try {
      const passwordData: UpdatePasswordData = {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      };

      const { success, error } = await AdminUserService.updatePassword(user.id, passwordData);

      if (success) {
        toast.success('Password updated successfully');
        passwordForm.reset();
        setShowPasswordForm(false);
      } else {
        toast.error(error || 'Failed to update password');
      }
    } catch (error) {
      toast.error('An error occurred while updating password');
    } finally {
      setIsLoadingPassword(false);
    }
  };

  return (
    <div className="w-full max-w-3xl 2xl:max-w-5xl">
      <h5 className="text-lg font-medium text-[var(--gray-12)]">
        General
      </h5>
      <p className="mt-0.5 text-sm text-balance text-[var(--gray-11)]">
        Update your account settings.
      </p>
      <div className="my-5 h-px bg-[var(--gray-a4)]" />
      <div className="mt-4 flex flex-col space-y-1.5">
        <span className="text-base font-medium text-[var(--gray-12)]">
          Avatar
        </span>
        <Avatar
          size={20}
          classNames={{
            root: "ring-primary-600 dark:ring-primary-500 rounded-xl ring-offset-[3px] ring-offset-[var(--color-background)]",
            display: "rounded-xl",
          }}
        >
          {user?.name?.charAt(0).toUpperCase() || 'U'}
        </Avatar>
        <p className="text-sm text-[var(--gray-a8)]">
          Your avatar is generated from your initials.
        </p>
      </div>
      <form onSubmit={profileForm.handleSubmit(onSubmitProfile)}>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 [&_.prefix]:pointer-events-none">
          <Input
            placeholder="Enter Name"
            label="Full name"
            className="rounded-xl"
            prefix={<UserIcon className="size-4.5" />}
            {...profileForm.register('name')}
            error={profileForm.formState.errors.name?.message}
          />
          <Input
            placeholder="Enter Email"
            label="Email"
            type="email"
            className="rounded-xl"
            prefix={<EnvelopeIcon className="size-4.5" />}
            {...profileForm.register('email')}
            error={profileForm.formState.errors.email?.message}
          />
        </div>

        <div className="mt-8 flex justify-end space-x-3">
          <Button
            type="button"
            className="min-w-[7rem]"
            onClick={() => profileForm.reset()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="min-w-[7rem]"
            color="cyan"
            disabled={isLoadingProfile}
          >
            Save Profile
          </Button>
        </div>
      </form>
      <div className="my-7 h-px bg-[var(--gray-a4)]" />
      <div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-medium text-[var(--gray-12)]">
              Password
            </p>
            <p className="mt-0.5 text-sm text-[var(--gray-11)]">
              Update your password to keep your account secure.
            </p>
          </div>
          <Button
            onClick={() => setShowPasswordForm(!showPasswordForm)}
            variant="outline"
            className="min-w-[7rem]"
          >
            {showPasswordForm ? 'Cancel' : 'Change Password'}
          </Button>
        </div>

        {showPasswordForm && (
          <form onSubmit={passwordForm.handleSubmit(onSubmitPassword)} className="mt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-1 max-w-md [&_.prefix]:pointer-events-none">
              <Input
                placeholder="Current Password"
                label="Current Password"
                type="password"
                className="rounded-xl"
                prefix={<LockClosedIcon className="size-4.5" />}
                {...passwordForm.register('currentPassword')}
                error={passwordForm.formState.errors.currentPassword?.message}
              />
              <Input
                placeholder="New Password"
                label="New Password"
                type="password"
                className="rounded-xl"
                prefix={<LockClosedIcon className="size-4.5" />}
                {...passwordForm.register('newPassword')}
                error={passwordForm.formState.errors.newPassword?.message}
              />
              <Input
                placeholder="Confirm New Password"
                label="Confirm New Password"
                type="password"
                className="rounded-xl"
                prefix={<LockClosedIcon className="size-4.5" />}
                {...passwordForm.register('confirmPassword')}
                error={passwordForm.formState.errors.confirmPassword?.message}
              />
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <Button
                type="button"
                className="min-w-[7rem]"
                onClick={() => {
                  passwordForm.reset();
                  setShowPasswordForm(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="min-w-[7rem]"
                color="cyan"
                disabled={isLoadingPassword}
              >
                Update Password
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
